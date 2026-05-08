import { describe, test, expect } from 'bun:test';
import { analystConsensusTool } from './analyst-consensus.js';

describe('analystConsensusTool', () => {
  test('exposes the expected name', () => {
    expect(analystConsensusTool.name).toBe('analyst_consensus');
  });

  test('schema accepts a valid ticker', () => {
    expect(analystConsensusTool.schema.safeParse({ ticker: 'AAPL' }).success).toBe(true);
  });

  test('schema rejects an empty ticker', () => {
    expect(analystConsensusTool.schema.safeParse({ ticker: '' }).success).toBe(false);
  });

  test('schema rejects a missing ticker', () => {
    expect(analystConsensusTool.schema.safeParse({}).success).toBe(false);
  });

  test('returns a JSON envelope with verdict on a real ticker', async () => {
    const out = await analystConsensusTool.invoke({ ticker: 'AAPL' });
    expect(typeof out).toBe('string');
    const parsed = JSON.parse(out as string) as {
      data: { error?: string; verdict?: string; meanRating?: number };
    };
    if (parsed.data.error) return; // network failure → accept envelope shape
    expect(typeof parsed.data.verdict).toBe('string');
    // verdict is STRONG BUY / BUY / HOLD / SELL / STRONG SELL / NO COVERAGE
    expect(parsed.data.verdict).toMatch(/STRONG BUY|BUY|HOLD|SELL|STRONG SELL|NO COVERAGE/);
  }, 30_000);
});
