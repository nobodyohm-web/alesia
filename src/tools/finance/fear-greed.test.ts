import { describe, test, expect } from 'bun:test';
import { fearGreedTool } from './fear-greed.js';

describe('fearGreedTool', () => {
  test('exposes the expected name and description', () => {
    expect(fearGreedTool.name).toBe('fear_greed_index');
    expect(fearGreedTool.description.toLowerCase()).toContain('fear');
  });

  test('schema accepts default input (no args)', () => {
    const parsed = fearGreedTool.schema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.limit).toBe(1);
  });

  test('schema accepts a valid limit within range', () => {
    const parsed = fearGreedTool.schema.safeParse({ limit: 7 });
    expect(parsed.success).toBe(true);
  });

  test('schema rejects a limit outside the supported range', () => {
    expect(fearGreedTool.schema.safeParse({ limit: 0 }).success).toBe(false);
    expect(fearGreedTool.schema.safeParse({ limit: 31 }).success).toBe(false);
    expect(fearGreedTool.schema.safeParse({ limit: 1.5 }).success).toBe(false);
  });

  test('returns a JSON envelope with score / classification when the API is reachable', async () => {
    const out = await fearGreedTool.invoke({ limit: 1 });
    expect(typeof out).toBe('string');
    const parsed = JSON.parse(out as string) as {
      data: { error?: string; score?: number; classification?: string };
    };
    if (parsed.data.error) {
      // Network failure is acceptable in CI — we just want a valid envelope.
      return;
    }
    expect(typeof parsed.data.score).toBe('number');
    expect(parsed.data.score).toBeGreaterThanOrEqual(0);
    expect(parsed.data.score).toBeLessThanOrEqual(100);
    expect(typeof parsed.data.classification).toBe('string');
  }, 15_000);
});
