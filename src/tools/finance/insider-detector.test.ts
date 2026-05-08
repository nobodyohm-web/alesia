import { describe, test, expect } from 'bun:test';
import { insiderDetectorTool } from './insider-detector.js';

describe('insiderDetectorTool', () => {
  test('exposes the expected name', () => {
    expect(insiderDetectorTool.name).toBe('insider_detector');
  });

  test('schema accepts a ticker with default threshold', () => {
    const parsed = insiderDetectorTool.schema.safeParse({ ticker: 'AAPL' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.materialThresholdUsd).toBe(1_000_000);
    }
  });

  test('schema accepts a custom threshold', () => {
    const parsed = insiderDetectorTool.schema.safeParse({
      ticker: 'AAPL',
      materialThresholdUsd: 500_000,
    });
    expect(parsed.success).toBe(true);
  });

  test('schema rejects an empty ticker', () => {
    expect(insiderDetectorTool.schema.safeParse({ ticker: '' }).success).toBe(false);
  });

  test('schema rejects a negative threshold', () => {
    expect(
      insiderDetectorTool.schema.safeParse({ ticker: 'AAPL', materialThresholdUsd: -1 }).success,
    ).toBe(false);
  });

  test('returns a JSON envelope with verdict on a bogus ticker', async () => {
    const out = await insiderDetectorTool.invoke({ ticker: '___NOT_A_TICKER___' });
    expect(typeof out).toBe('string');
    const parsed = JSON.parse(out as string) as { data: Record<string, unknown> };
    expect(parsed).toHaveProperty('data');
    expect(typeof parsed.data).toBe('object');
  }, 30_000);
});
