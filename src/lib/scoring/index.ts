import type { EngineTestResult, Evaluation, ProgressInfo, ScoreInput, Settings } from '../../types';
import { aiScore, preloadLocal, testEngine } from './ai';
import { rulesScore } from './rules';
import { MIN_WORDS_TO_SCORE } from './score';

type OnProgress = (p: ProgressInfo) => void;

/**
 * Scores an answer. The built-in rules always run first (delivery metrics are always local). If an
 * AI engine is configured it produces the final evaluation. AI failures never throw: you get the
 * rules result with `warning` set.
 */
export async function scoreAnswer(
  input: ScoreInput,
  settings: Settings,
  onProgress?: OnProgress,
): Promise<Evaluation> {
  const base = rulesScore(input);
  if (settings.scoring === 'rules') return base;
  // Nothing worth sending to a model.
  if (base.delivery.wordCount < MIN_WORDS_TO_SCORE) return base;

  try {
    return await aiScore(input, settings, base, onProgress);
  } catch (e) {
    const reason = (e instanceof Error ? e.message : String(e)).replace(/[.\s]+$/, '');
    return {
      ...base,
      warning: `AI scoring failed (${settings.scoring}): ${reason}. Showing the built-in rules score instead.`,
    };
  }
}

export async function preloadScorer(settings: Settings, onProgress?: OnProgress): Promise<void> {
  if (settings.scoring !== 'local') return;
  await preloadLocal(settings, onProgress);
}

export async function testScoringEngine(settings: Settings): Promise<EngineTestResult> {
  return testEngine(settings);
}
