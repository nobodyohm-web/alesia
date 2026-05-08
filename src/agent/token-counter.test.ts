import { describe, test, expect } from 'bun:test';
import { TokenCounter } from './token-counter.js';

describe('TokenCounter', () => {
  test('starts with no recorded usage', () => {
    const tc = new TokenCounter();
    expect(tc.getUsage()).toBeUndefined();
  });

  test('add(undefined) is a no-op', () => {
    const tc = new TokenCounter();
    tc.add(undefined);
    expect(tc.getUsage()).toBeUndefined();
  });

  test('accumulates tokens across calls', () => {
    const tc = new TokenCounter();
    tc.add({ inputTokens: 100, outputTokens: 50, totalTokens: 150 });
    tc.add({ inputTokens: 200, outputTokens: 100, totalTokens: 300 });
    const usage = tc.getUsage();
    expect(usage?.inputTokens).toBe(300);
    expect(usage?.outputTokens).toBe(150);
    expect(usage?.totalTokens).toBe(450);
  });

  test('getTokensPerSecond returns undefined for zero tokens', () => {
    const tc = new TokenCounter();
    expect(tc.getTokensPerSecond(1000)).toBeUndefined();
  });

  test('getTokensPerSecond returns undefined for non-positive elapsed time', () => {
    const tc = new TokenCounter();
    tc.add({ inputTokens: 100, outputTokens: 50, totalTokens: 150 });
    expect(tc.getTokensPerSecond(0)).toBeUndefined();
    expect(tc.getTokensPerSecond(-10)).toBeUndefined();
  });

  test('getTokensPerSecond divides totalTokens by elapsed seconds', () => {
    const tc = new TokenCounter();
    tc.add({ inputTokens: 0, outputTokens: 0, totalTokens: 1000 });
    expect(tc.getTokensPerSecond(1000)).toBe(1000); // 1000 tokens / 1s
    expect(tc.getTokensPerSecond(2000)).toBe(500); // 1000 tokens / 2s
  });

  test('getUsage returns a defensive copy (callers cannot mutate internal state)', () => {
    const tc = new TokenCounter();
    tc.add({ inputTokens: 100, outputTokens: 50, totalTokens: 150 });
    const usage = tc.getUsage();
    expect(usage).toBeDefined();
    if (usage) {
      usage.inputTokens = 999;
    }
    expect(tc.getUsage()?.inputTokens).toBe(100);
  });
});
