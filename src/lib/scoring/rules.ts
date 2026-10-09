// Built-in rules engine. It cannot understand meaning, so it only looks at things it can see:
// overlap with the question, specifics, outcome language, sentence shape, and a list of red-flag
// phrases. It is deliberately simple and says so in its summary.
import rubric from '../../data/rubric.json';
import type {
  AspectKey,
  AspectRating,
  AspectScore,
  Competency,
  DeliveryMetrics,
  Evaluation,
  FeedbackPoint,
  ScoreInput,
} from '../../types';
import { computeDelivery, words } from './delivery';
import { ASPECTS, MIN_WORDS_TO_SCORE, finalScore, toRating, verdictFor } from './score';

const STOPWORDS = new Set(
  (
    'a an the and or but if then than so of to in on at by for with from into onto over under about as is are was were be been being am do does did done doing ' +
    'have has had having i me my mine we us our you your he she it its they them their this that these those there here what which who whom whose when where why how ' +
    'can could would should will shall may might must not no yes any some all each every more most much many very just also too only own same such other another ' +
    'tell describe give gave example time times talk explain say said think thing things way ways one two out up down off again further once ' +
    'please question answer role tell us about situation'
  ).split(/\s+/),
);

const FIRST_PERSON_RE = /\b(?:i|i'm|i've|i'd|i'll|my|me)\b/;
const NUMBER_RE =
  /\b\d[\d,.]*\s*(?:%|percent|k|m|x|hours?|days?|weeks?|months?|years?|people|users|customers|clients|members|pounds|dollars|euros)?\b|[$£€]\s?\d/g;
const NUMBER_WORD_RE =
  /\b(?:two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|hundred|thousand|million|double|doubled|tripled|half)\b/g;

const FLAGS = (
  rubric.redFlags as { id: string; label: string; suggestion: string; patterns: string[] }[]
).map((f) => ({ ...f, res: f.patterns.map((p) => new RegExp(p, 'i')) }));

const ACTION_RE = new RegExp(
  '\\bi\\s+(?:then\\s+|also\\s+|first\\s+|personally\\s+|quickly\\s+|immediately\\s+)?(?:' +
    (rubric.actionVerbs as string[]).join('|') +
    ')\\b',
);

const norm = (s: string) => s.replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();

export function splitSentences(text: string): string[] {
  const t = norm(text);
  if (!t) return [];
  const parts = t
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])|(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  // Some transcripts come without punctuation; chunk long runs so quotes stay short.
  const out: string[] = [];
  for (const p of parts) {
    const w = p.split(' ');
    if (w.length <= 45) out.push(p);
    else for (let i = 0; i < w.length; i += 30) out.push(w.slice(i, i + 30).join(' '));
  }
  return out;
}

const short = (s: string, max = 170) => (s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '...');

const stem = (w: string) => (w.length > 5 ? w.slice(0, 5) : w);
function contentStems(text: string): Set<string> {
  return new Set(
    words(text)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
      .map(stem),
  );
}

export interface RedFlagHit {
  id: string;
  label: string;
  suggestion: string;
  sentence: string;
}

export function findRedFlags(text: string): RedFlagHit[] {
  const hits: RedFlagHit[] = [];
  for (const sentence of splitSentences(text)) {
    const s = sentence.toLowerCase();
    for (const f of FLAGS) {
      if (f.res.some((re) => re.test(s))) {
        hits.push({ id: f.id, label: f.label, suggestion: f.suggestion, sentence });
        break; // one point per sentence
      }
    }
  }
  return hits;
}

function countMatches(re: RegExp, s: string): number {
  return (s.match(re) ?? []).length;
}

function hasOutcome(s: string): boolean {
  const l = s.toLowerCase();
  return (rubric.outcomeCues as string[]).some((c) => l.includes(c));
}

function vagueCount(l: string): number {
  return (rubric.vagueCues as string[]).filter((c) => l.includes(c)).length;
}

function repetition(ws: string[]): number {
  if (ws.length < 30) return 0;
  const seen = new Map<string, number>();
  for (let i = 0; i + 2 < ws.length; i++) {
    const g = ws.slice(i, i + 3).join(' ');
    seen.set(g, (seen.get(g) ?? 0) + 1);
  }
  let rep = 0;
  seen.forEach((n) => {
    if (n > 1) rep += n - 1;
  });
  return rep / Math.max(1, ws.length - 2);
}

function fixedShort(input: ScoreInput, delivery: DeliveryMetrics): Evaluation {
  const empty = delivery.wordCount === 0;
  const aspects: AspectScore[] = [
    {
      key: 'relevance',
      label: label('relevance'),
      rating: -2,
      comment: empty ? 'There was nothing to judge.' : 'Too little was said to answer the question.',
    },
    { key: 'substance', label: label('substance'), rating: -2, comment: 'No details were given.' },
    {
      key: 'judgement',
      label: label('judgement'),
      rating: 0,
      comment: 'Nothing was said that raises a concern, but there is not enough to judge.',
    },
    { key: 'impact', label: label('impact'), rating: -2, comment: 'No result or outcome was mentioned.' },
    { key: 'clarity', label: label('clarity'), rating: -1, comment: 'There was not enough to follow.' },
  ];
  return {
    score: -40,
    verdict: 'Negative',
    summary: empty
      ? 'No answer was picked up. An empty answer counts against you in a real interview. Check your microphone and try again.'
      : `Only ${delivery.wordCount} words were picked up. An answer this short does not show an employer anything about you. Aim for a full example that runs at least a minute.`,
    aspects,
    points: [
      {
        kind: 'negative',
        quote: '',
        comment: empty
          ? 'No speech was detected in the recording.'
          : 'The answer is far too short to answer the question.',
        suggestion: `Pick one real example and spend the time on what you did and what came of it. Question: "${input.question.text}"`,
      },
    ],
    delivery,
    presence: input.gaze,
    source: 'rules',
  };
}

function label(k: AspectKey): string {
  return ASPECTS.find((a) => a.key === k)?.label ?? k;
}

const rate = (n: number): AspectRating => toRating(n);

export function rulesScore(input: ScoreInput): Evaluation {
  const text = norm(input.transcript.text);
  const delivery = computeDelivery(input.transcript, input.durationSec, input.maxSeconds);
  if (delivery.wordCount < MIN_WORDS_TO_SCORE) return fixedShort(input, delivery);

  const sentences = splitSentences(text);
  const ws = words(text);
  const lower = text.toLowerCase();
  const wc = ws.length;

  // Relevance
  const qStems = contentStems(input.question.text);
  const aStems = contentStems(text);
  let covered = 0;
  qStems.forEach((s) => {
    if (aStems.has(s)) covered++;
  });
  const overlap = qStems.size ? covered / qStems.size : 0;
  let compHits = 0;
  for (const c of input.question.competencies as Competency[]) {
    const lex = (rubric.competencyLexicon as Record<string, string[]>)[c] ?? [];
    compHits += lex.filter((term) => lower.includes(term)).length;
  }
  let relevance: number;
  if (overlap >= 0.4 && compHits >= 2) relevance = 2;
  else if (overlap >= 0.25 || compHits >= 3) relevance = 1;
  else if (overlap >= 0.1 || compHits >= 1) relevance = 0;
  else relevance = wc >= 40 ? -2 : -1;

  // Substance
  const numbers = countMatches(NUMBER_RE, lower) + Math.min(2, countMatches(NUMBER_WORD_RE, lower));
  const actionSentences = sentences.filter((s) => ACTION_RE.test(s.toLowerCase()));
  const named = sentences.reduce((n, s) => {
    const tail = s.split(' ').slice(1).join(' ');
    return n + (tail.match(/\b[A-Z][a-z]{2,}\b/g) ?? []).filter((w) => w !== 'I').length;
  }, 0);
  const specifics = Math.min(numbers, 4) + Math.min(actionSentences.length, 5) + Math.min(named, 3);
  const vague = vagueCount(lower);
  let substance = specifics >= 8 ? 2 : specifics >= 5 ? 1 : specifics >= 3 ? 0 : specifics >= 1 ? -1 : -2;
  if (vague >= 2 && specifics < 6) substance -= 1;
  if (!FIRST_PERSON_RE.test(lower)) substance -= 1;

  // Impact
  const outcomeSentences = sentences.filter(hasOutcome);
  const outcomeWithNumber = outcomeSentences.filter((s) => countMatches(NUMBER_RE, s.toLowerCase()) > 0);
  let impact: number;
  if (outcomeSentences.length >= 2 && outcomeWithNumber.length >= 1) impact = 2;
  else if (outcomeSentences.length >= 2 || outcomeWithNumber.length >= 1) impact = 1;
  else if (outcomeSentences.length === 1) impact = 0;
  else impact = wc >= 60 && substance <= -1 ? -2 : -1;

  // Clarity
  const punctuated = sentences.length > 1 || wc < 40;
  const avgLen = wc / Math.max(1, sentences.length);
  let clarity = 1;
  if (punctuated && avgLen > 35) clarity -= 1;
  if (punctuated && avgLen < 5) clarity -= 1;
  const fillerPer100 = (delivery.fillerCount / wc) * 100;
  if (fillerPer100 > 8) clarity -= 2;
  else if (fillerPer100 > 4) clarity -= 1;
  if (repetition(ws) > 0.08) clarity -= 1;
  if (wc < 30) clarity -= 1;

  // Judgement: neutral unless a red flag is found.
  const flagHits = findRedFlags(text);
  const judgement = flagHits.length ? -2 : 0;

  const ratings: Record<AspectKey, AspectRating> = {
    relevance: rate(relevance),
    substance: rate(substance),
    judgement: rate(judgement),
    impact: rate(impact),
    clarity: rate(clarity),
  };

  const comments: Record<AspectKey, string> = {
    relevance:
      ratings.relevance >= 1
        ? 'Your wording lines up well with what the question asked.'
        : ratings.relevance === 0
          ? "Only some of the question's key words show up in your answer. Make sure you answer it directly."
          : 'Your answer barely touches the words of the question. It may be off topic.',
    substance:
      ratings.substance >= 1
        ? `You gave concrete detail: ${numbers} number${numbers === 1 ? '' : 's'} and ${actionSentences.length} sentence${actionSentences.length === 1 ? '' : 's'} about what you personally did.`
        : ratings.substance === 0
          ? 'There is some detail, but not enough numbers, names or actions to make the story believable.'
          : 'The answer stays general. There are few numbers, names or "I did" actions.',
    judgement: flagHits.length
      ? 'You said something an employer would see as a serious concern. See the flagged quote.'
      : 'Nothing worrying was found. The built-in rules can only catch obvious phrases, so this is not a full judgement check.',
    impact:
      ratings.impact >= 1
        ? 'You said what came of your actions, which is what employers listen for.'
        : ratings.impact === 0
          ? 'You hinted at a result but did not say how big it was or who it helped.'
          : 'You did not say what the result was.',
    clarity:
      ratings.clarity >= 1
        ? 'Your sentences were a sensible length with few fillers.'
        : 'The answer was harder to follow because of ' +
          [
            punctuated && avgLen > 35 ? 'very long sentences' : '',
            punctuated && avgLen < 5 ? 'choppy fragments' : '',
            fillerPer100 > 4 ? 'filler words' : '',
            repetition(ws) > 0.08 ? 'repeated phrases' : '',
            wc < 30 ? 'its short length' : '',
          ]
            .filter(Boolean)
            .join(' and ') +
          '.',
  };

  const aspects: AspectScore[] = ASPECTS.map((a) => ({
    key: a.key,
    label: a.label,
    rating: ratings[a.key],
    comment: comments[a.key],
  }));

  // Points
  const redPoints: FeedbackPoint[] = flagHits.slice(0, 3).map((h) => ({
    kind: 'red_flag',
    quote: short(h.sentence),
    comment: `${h.label}. An employer would take this as a reason not to hire you.`,
    suggestion: h.suggestion,
  }));
  const flagged = new Set(flagHits.map((h) => h.sentence));

  const negPoints: FeedbackPoint[] = [];
  const vagueSentences = sentences.filter((s) => !flagged.has(s) && vagueCount(s.toLowerCase()) > 0);
  for (const s of vagueSentences.slice(0, 2)) {
    negPoints.push({
      kind: 'negative',
      quote: short(s),
      comment: 'This is a claim anyone could make. It does not show an employer anything.',
      suggestion: 'Replace it with one thing you did, with a number or a name in it.',
    });
  }
  if (outcomeSentences.length === 0 && negPoints.length < 3) {
    negPoints.push({
      kind: 'negative',
      quote: '',
      comment: 'You never said what the result was.',
      suggestion: 'End with the outcome, ideally with a number: what changed because of what you did.',
    });
  }
  if (numbers === 0 && negPoints.length < 3 && !flagHits.length) {
    negPoints.push({
      kind: 'negative',
      quote: '',
      comment: 'There are no numbers anywhere in the answer.',
      suggestion: 'Add one figure such as team size, time saved, money, or a percentage.',
    });
  }
  if (overlap < 0.1 && compHits === 0 && negPoints.length < 3) {
    negPoints.push({
      kind: 'negative',
      quote: '',
      comment: 'Your answer does not seem to address the question that was asked.',
      suggestion: `Start by answering it directly: "${input.question.text}"`,
    });
  }

  const posPoints: FeedbackPoint[] = [];
  const usedPos = new Set<string>();
  const strong = sentences
    .filter((s) => !flagged.has(s) && s.split(' ').length >= 7)
    .map((s) => {
      const l = s.toLowerCase();
      const n = countMatches(NUMBER_RE, l) > 0;
      const o = hasOutcome(s);
      const a = ACTION_RE.test(l);
      return { s, score: (n ? 2 : 0) + (o ? 2 : 0) + (a ? 1 : 0) - vagueCount(l) * 2 };
    })
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score);
  for (const x of strong) {
    if (posPoints.length >= 3) break;
    if (usedPos.has(x.s)) continue;
    usedPos.add(x.s);
    const l = x.s.toLowerCase();
    const n = countMatches(NUMBER_RE, l) > 0;
    const o = hasOutcome(x.s);
    posPoints.push({
      kind: 'positive',
      quote: short(x.s),
      comment:
        n && o
          ? 'A concrete result with a number. This is the kind of line that makes an answer believable.'
          : o
            ? 'You said what came out of your actions.'
            : n
              ? 'The specific figure makes this credible.'
              : 'You described something you actually did, rather than a general trait.',
    });
  }

  const finalPoints = [...redPoints, ...negPoints, ...posPoints];
  const score = finalScore(ratings, delivery, flagHits.length);
  const verdict = verdictFor(score);

  const summary = buildSummary(verdict, flagHits.length, ratings, delivery);

  return {
    score,
    verdict,
    summary,
    aspects,
    points: finalPoints,
    delivery,
    presence: input.gaze,
    source: 'rules',
  };
}

function buildSummary(
  verdict: string,
  flags: number,
  r: Record<AspectKey, AspectRating>,
  d: DeliveryMetrics,
): string {
  const parts: string[] = [];
  if (flags > 0) {
    parts.push(
      flags === 1
        ? 'You said something that an employer would treat as a red flag, and that outweighs everything else in the answer.'
        : `You said ${flags} things that an employer would treat as red flags, and that outweighs everything else in the answer.`,
    );
    parts.push('Drop that example and choose one that shows you in a good light.');
  } else if (verdict === 'Very positive' || verdict === 'Positive') {
    parts.push(
      r.impact >= 1
        ? 'This answer would help you. It gives concrete detail and says what came of it.'
        : 'This answer would help you. It stays on the question and gives real detail.',
    );
    if (r.impact < 1) parts.push('It would be stronger with a clear result at the end.');
  } else if (verdict === 'Neutral') {
    parts.push(
      'This answer would neither help nor hurt you. It is on topic but lacks the detail that sets candidates apart.',
    );
    parts.push(r.substance < 1 ? 'Add a specific action and a number.' : 'Add a clear result.');
  } else {
    parts.push('This answer would count against you. It is too general to show an employer what you can do.');
    parts.push(
      r.relevance < 0
        ? 'It also barely addresses the question.'
        : 'Use one real example, say what you did and what came of it.',
    );
  }
  if (d.fillerRatePerMin > 6)
    parts.push(`You used filler words about ${Math.round(d.fillerRatePerMin)} times a minute.`);
  parts.push(
    'This score comes from built-in rules that cannot understand meaning. Use an AI engine for a real read.',
  );
  return parts.join(' ');
}
