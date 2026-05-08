import { describe, test, expect } from 'bun:test';
import {
  estimateTokens,
  getEffectiveContextWindow,
  getAutoCompactThreshold,
} from './tokens.js';

describe('estimateTokens', () => {
  test('approximates tokens at ~3.5 chars per token', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('hello world')).toBe(Math.ceil(11 / 3.5));
  });
});

describe('threshold formulas — large context windows behave like the old constants', () => {
  // These are sanity checks. For windows >= ~133K, the proportional reservation
  // saturates at the old constants (20K output reserve + 13K buffer = 33K total).
  test('Anthropic 200K window: effective=180K, threshold=167K', () => {
    // claude-sonnet-4-6 → anthropic provider → 200K window
    expect(getEffectiveContextWindow('claude-sonnet-4-6')).toBe(180_000);
    expect(getAutoCompactThreshold('claude-sonnet-4-6')).toBe(167_000);
  });

  test('OpenAI 1M window: 20K output reserve, 13K buffer (matches old constants)', () => {
    // OpenAI declares 1_047_576 in providers.ts; reservations cap at 20K + 13K.
    expect(getEffectiveContextWindow('gpt-5.4')).toBe(1_047_576 - 20_000);
    expect(getAutoCompactThreshold('gpt-5.4')).toBe(1_047_576 - 20_000 - 13_000);
  });
});

describe('threshold formulas — small context windows scale proportionally', () => {
  test('Ollama 65K window: threshold is positive and at most 75% of window', () => {
    const threshold = getAutoCompactThreshold('ollama:gemma2:27b');
    expect(threshold).toBeGreaterThan(0);
    expect(threshold).toBeLessThanOrEqual(Math.floor(65_536 * 0.75) + 100);
  });

  test('Ollama 65K effective = 65K - clamp(15%, 4K, 20K)', () => {
    // 15% of 65K = ~9830, clamped to [4K, 20K] → reserves 9830
    // effective = 65_536 - 9830 = 55_706
    const effective = getEffectiveContextWindow('ollama:gemma2:27b');
    expect(effective).toBe(65_536 - Math.floor(65_536 * 0.15));
  });

  test('Ollama threshold leaves at least MIN_AUTOCOMPACT_BUFFER below effective', () => {
    const effective = getEffectiveContextWindow('ollama:gemma2:27b');
    const threshold = getAutoCompactThreshold('ollama:gemma2:27b');
    expect(effective - threshold).toBeGreaterThanOrEqual(2_000);
  });
});

describe('threshold never returns negative', () => {
  test('even with a tiny synthetic ctx (via unknown provider fallback), threshold >= 0', () => {
    // Unknown provider falls back to DEFAULT_CONTEXT_WINDOW=128K — should be sane.
    const threshold = getAutoCompactThreshold('totally-unknown-model');
    expect(threshold).toBeGreaterThan(0);
  });
});
