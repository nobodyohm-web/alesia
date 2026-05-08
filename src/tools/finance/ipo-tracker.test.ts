import { describe, test, expect } from 'bun:test';
import { ipoTrackerTool } from './ipo-tracker.js';

describe('ipoTrackerTool', () => {
  test('exposes the expected name', () => {
    expect(ipoTrackerTool.name).toBe('ipo_tracker');
  });

  test('schema accepts a valid query', () => {
    expect(
      ipoTrackerTool.schema.safeParse({ query: 'upcoming IPOs this month' }).success,
    ).toBe(true);
  });

  test('schema rejects an empty query', () => {
    expect(ipoTrackerTool.schema.safeParse({ query: '' }).success).toBe(false);
  });

  test('schema rejects a missing query', () => {
    expect(ipoTrackerTool.schema.safeParse({}).success).toBe(false);
  });

  test('returns a JSON envelope with ipos array or message on real call', async () => {
    const out = await ipoTrackerTool.invoke({ query: 'upcoming IPOs this month' });
    expect(typeof out).toBe('string');
    const parsed = JSON.parse(out as string) as {
      data: { ipos?: unknown[]; message?: string; query?: string };
      sourceUrls?: string[];
    };
    expect(parsed).toHaveProperty('data');
    // Either we got results or a "no data" message — both are valid envelope shapes.
    const hasIpos = Array.isArray(parsed.data.ipos);
    const hasMessage = typeof parsed.data.message === 'string';
    expect(hasIpos || hasMessage).toBe(true);
  }, 30_000);
});
