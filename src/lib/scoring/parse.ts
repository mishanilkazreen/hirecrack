// Turns raw model output into a validated Evaluation.
import type {
  AspectKey,
  AspectScore,
  DeliveryMetrics,
  Evaluation,
  FeedbackPoint,
  ScoreInput,
} from '../../types';
import { findRedFlags } from './rules';
import { ASPECTS, finalScore, toRating, verdictFor } from './score';

type Frame = { t: '{' | '['; st: 'key' | 'colon' | 'value' | 'after'; keyStart: number };

/**
 * Best-effort repair of almost-JSON from small models: smart or single quotes, raw newlines and
 * unescaped quotes inside strings, trailing commas, missing commas, text before or after the
 * object, and truncation (open strings, dangling keys, unclosed arrays and objects).
 */
export function repairJson(raw: string): string {
  let s = raw.replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)(```|$)/i);
  if (fence && fence[1].includes('{')) s = fence[1];
  const start = s.indexOf('{');
  if (start === -1) throw new Error('The model did not return valid JSON');
  s = s.slice(start);

  let out = '';
  const stack: Frame[] = [];
  const top = () => stack[stack.length - 1];
  const OPEN = new Set(['"', "'", '“', '‘']);
  const closers = (c: string) => (c === '"' || c === '“' ? '"”“' : c === '‘' ? '’' : "'");
  const valueDone = () => {
    const f = top();
    if (f) f.st = 'after';
  };
  const trimComma = () => {
    out = out.replace(/[\s,]+$/, '');
  };
  const needComma = () => {
    const f = top();
    if (f && f.st === 'after') {
      out += ',';
      f.st = f.t === '{' ? 'key' : 'value';
    }
  };
  let done = false;
  let i = 0;
  for (; i < s.length && !done; i++) {
    const c = s[i];
    if (/\s/.test(c)) {
      out += c;
      continue;
    }
    if (c === '{' || c === '[') {
      needComma();
      stack.push({ t: c, st: c === '{' ? 'key' : 'value', keyStart: -1 });
      out += c;
    } else if (c === '}' || c === ']') {
      const f = top();
      if (!f) break;
      if (f.t !== (c === '}' ? '{' : '[')) continue; // mismatched closer, skip it
      if (f.t === '{' && (f.st === 'colon' || f.st === 'value') && f.keyStart >= 0)
        out = out.slice(0, f.keyStart);
      trimComma();
      out += c;
      stack.pop();
      if (stack.length === 0) done = true;
      else valueDone();
    } else if (c === ',') {
      const f = top();
      if (f && f.st === 'after') {
        out += ',';
        f.st = f.t === '{' ? 'key' : 'value';
      }
    } else if (c === ':') {
      const f = top();
      if (f && f.t === '{' && f.st === 'colon') {
        out += ':';
        f.st = 'value';
      }
    } else if (OPEN.has(c)) {
      const f = top();
      needComma();
      const isKey = !!f && f.t === '{' && f.st === 'key';
      if (isKey) f.keyStart = out.length;
      let str = '';
      const closeSet = closers(c);
      let j = i + 1;
      for (; j < s.length; j++) {
        const d = s[j];
        if (d === '\\') {
          const n = s[j + 1];
          if (n === undefined) break;
          j++;
          if (n === 'n' || n === 't' || n === 'r') str += ' ';
          else if (n === '"' || n === '\\' || n === 'u') str += '\\' + n;
          else str += n;
        } else if (closeSet.includes(d)) {
          // A quote inside the text only ends the string when a delimiter (or the end) follows.
          const nx = s.slice(j + 1).match(/^\s*(.)?/)?.[1];
          if (nx === undefined || /[,:}\]]/.test(nx)) break;
          str += "'";
        } else if (d === '"') str += "'";
        else if (d < ' ') str += ' ';
        else str += d;
      }
      i = j; // j is at the closing quote, or past the end when truncated
      out += `"${str}"`;
      if (f) f.st = isKey ? 'colon' : 'after';
    } else {
      // number, true/false/null, or a bare word
      needComma();
      const m = s.slice(i).match(/^[^\s,:{}[\]"']+/);
      const tok = m ? m[0] : c;
      i += tok.length - 1;
      const atEnd = i >= s.length - 1;
      const f = top();
      if (f && f.t === '{' && f.st === 'key') {
        // bare key: quote it
        f.keyStart = out.length;
        out += `"${tok.replace(/"/g, '')}"`;
        f.st = 'colon';
      } else if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(tok) || /^(true|false|null)$/.test(tok)) {
        out += tok;
        valueDone();
      } else if (/^-?\d/.test(tok) && !atEnd) {
        out += String(parseFloat(tok) || 0);
        valueDone();
      } else if (atEnd) {
        // truncated half-written value: drop it
        if (f && f.t === '{' && f.keyStart >= 0) out = out.slice(0, f.keyStart);
        trimComma();
        break;
      } else {
        out += `"${tok}"`;
        valueDone();
      }
    }
  }
  // Truncated: drop a dangling key or colon, then close everything that is open.
  while (stack.length > 0) {
    const f = top();
    if (f.t === '{' && (f.st === 'colon' || f.st === 'value') && f.keyStart >= 0)
      out = out.slice(0, f.keyStart);
    trimComma();
    out += f.t === '{' ? '}' : ']';
    stack.pop();
    if (stack.length > 0) valueDone();
  }
  return out;
}

/** First balanced, strictly valid JSON object inside surrounding chatter, or undefined. */
function scanBalanced(s: string): unknown {
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1].includes('{')) s = fence[1];
  for (let start = s.indexOf('{'); start !== -1; start = s.indexOf('{', start + 1)) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    let closed = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        closed = true;
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch {
          start = i; // skip the whole broken object, not just its first brace
          break;
        }
      }
    }
    // Never closed (truncated): an inner object would be the wrong answer, so let repair handle it.
    if (!closed) return undefined;
  }
  return undefined;
}

/** Parses model output into a JSON value, repairing common slips. Throws only if nothing usable. */
export function extractJson(raw: string): unknown {
  const stripped = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  try {
    return JSON.parse(stripped);
  } catch {
    /* repair below */
  }
  const strict = scanBalanced(stripped);
  if (strict !== undefined) return strict;
  let fixed: string;
  try {
    fixed = repairJson(raw);
  } catch {
    throw new Error('The model did not return valid JSON');
  }
  try {
    const v = JSON.parse(fixed);
    if (isObj(v) && Object.keys(v).length > 0) return v;
  } catch {
    /* fall through */
  }
  throw new Error('The model did not return valid JSON');
}

/** Case, whitespace and punctuation insensitive form used to compare quotes with the transcript. */
export function normaliseForQuote(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function quoteInTranscript(quote: string, transcript: string): boolean {
  const q = normaliseForQuote(quote);
  if (q.split(' ').length < 2 && q.length < 4) return false;
  return !!q && normaliseForQuote(transcript).includes(q);
}

const str = (v: unknown, max = 600): string =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').replace(/[—–]/g, ',').trim().slice(0, max) : '';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

const SHORT_KEYS: Record<string, AspectKey> = {
  r: 'relevance',
  s: 'substance',
  j: 'judgement',
  i: 'impact',
  c: 'clarity',
};

type AspectRead = { rating: number | null; comment: string };

const hasRating = (v: unknown): boolean =>
  (typeof v === 'number' && Number.isFinite(v)) ||
  (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)));

/** Reads full ({"relevance": {"rating", "comment"}}) or short ({"a": {"r": 1}, "m": {"r": "..."}}) aspects. */
function readAspects(root: Obj): Record<AspectKey, AspectRead> {
  const out = {} as Record<AspectKey, AspectRead>;
  const raw = root.aspects ?? root.a;
  const src: Obj = Array.isArray(raw)
    ? Object.fromEntries(raw.filter(isObj).map((a) => [String(a.key ?? a.name ?? ''), a]))
    : isObj(raw)
      ? raw
      : {};
  const notes = isObj(root.m) ? root.m : isObj(root.comments) ? root.comments : {};
  for (const a of ASPECTS) {
    const short = Object.keys(SHORT_KEYS).find((k) => SHORT_KEYS[k] === a.key) as string;
    const v = src[a.key] ?? src[short];
    const note = str(notes[short] ?? notes[a.key]);
    if (isObj(v)) {
      const r = v.rating ?? v.score;
      out[a.key] = { rating: hasRating(r) ? toRating(r) : null, comment: str(v.comment ?? v.reason) || note };
    } else if (hasRating(v)) out[a.key] = { rating: toRating(v), comment: note };
    else out[a.key] = { rating: null, comment: note };
  }
  return out;
}

const KIND_ORDER = { red_flag: 0, negative: 1, positive: 2 } as const;

function readKind(raw: string, hasSuggestion: boolean): FeedbackPoint['kind'] {
  const k = raw.toLowerCase();
  if (k.includes('|')) return hasSuggestion ? 'negative' : 'positive'; // copied the placeholder
  if (k.includes('red') || k.includes('flag')) return 'red_flag';
  if (k.includes('neg')) return 'negative';
  if (k.includes('pos')) return 'positive';
  return hasSuggestion ? 'negative' : 'positive';
}

export function readPoints(raw: unknown, transcript: string): FeedbackPoint[] {
  if (!Array.isArray(raw)) return [];
  const out: FeedbackPoint[] = [];
  for (const p of raw) {
    if (!isObj(p)) continue;
    const suggestion = str(p.suggestion ?? p.fix ?? p.s);
    const kind = readKind(str(p.kind ?? p.type ?? p.k, 40), !!suggestion);
    let quote = str(p.quote ?? p.q, 240);
    if (quote && !quoteInTranscript(quote, transcript)) quote = ''; // invented or altered quote
    const comment = str(p.comment ?? p.why ?? p.c);
    if (!comment) continue;
    // A claim about what the candidate said needs a real quote behind it.
    if (!quote && (kind === 'red_flag' || kind === 'positive')) continue;
    out.push({ kind, quote, comment, ...(kind !== 'positive' && suggestion ? { suggestion } : {}) });
  }
  return out;
}

export interface AiBuildOptions {
  input: ScoreInput;
  delivery: DeliveryMetrics;
  /** Rules evaluation, used for fallback text and as a safety net for obvious red flags. */
  rules: Evaluation;
  model: string;
}

export function buildAiEvaluation(rawJson: unknown, o: AiBuildOptions): Evaluation {
  if (!isObj(rawJson)) throw new Error('The model returned JSON in an unexpected shape');
  const transcript = o.input.transcript.text;
  const read = readAspects(rawJson);
  if (!ASPECTS.some((a) => read[a.key].rating !== null))
    throw new Error('The model reply had no usable ratings');
  const rated = {} as Record<AspectKey, { rating: number; comment: string }>;
  for (const a of ASPECTS) {
    const fallback = o.rules.aspects.find((x) => x.key === a.key);
    rated[a.key] = {
      rating: read[a.key].rating ?? fallback?.rating ?? 0,
      comment: read[a.key].comment,
    };
  }
  let points = readPoints(rawJson.points ?? rawJson.p, transcript);
  if (points.length === 0) points = o.rules.points.map((p) => ({ ...p }));

  // Safety net: obvious red-flag phrases the model missed still count.
  const modelFlags = points.filter((p) => p.kind === 'red_flag');
  for (const hit of findRedFlags(transcript)) {
    const hq = normaliseForQuote(hit.sentence);
    const covered = modelFlags.some((p) => {
      const pq = normaliseForQuote(p.quote);
      return hq.includes(pq) || pq.includes(hq);
    });
    if (!covered)
      points.push({
        kind: 'red_flag',
        quote: hit.sentence.slice(0, 170),
        comment: `${hit.label}. An employer would take this as a reason not to hire you.`,
        suggestion: hit.suggestion,
      });
  }
  const flags = points.filter((p) => p.kind === 'red_flag').length;
  if (flags > 0 && rated.judgement.rating > -2) rated.judgement.rating = toRating(-2);

  points = points
    .map((p, i) => ({ p, i }))
    .sort((a, b) => KIND_ORDER[a.p.kind] - KIND_ORDER[b.p.kind] || a.i - b.i)
    .map((x) => x.p)
    .slice(0, 8);

  const ratings = Object.fromEntries(ASPECTS.map((a) => [a.key, rated[a.key].rating])) as Record<
    AspectKey,
    number
  >;
  const aspects: AspectScore[] = ASPECTS.map((a) => ({
    key: a.key,
    label: a.label,
    rating: toRating(rated[a.key].rating),
    comment: rated[a.key].comment || o.rules.aspects.find((x) => x.key === a.key)?.comment || '',
  }));

  const score = finalScore(ratings, o.delivery, flags);
  const summary = str(rawJson.summary, 900);
  const better = str(rawJson.better_answer ?? rawJson.betterAnswer ?? rawJson.b, 1500);
  return {
    score,
    verdict: verdictFor(score),
    summary: summary || o.rules.summary,
    aspects,
    points,
    ...(better ? { betterAnswer: better } : {}),
    delivery: o.delivery,
    presence: o.input.gaze,
    source: 'ai',
    model: o.model,
  };
}
