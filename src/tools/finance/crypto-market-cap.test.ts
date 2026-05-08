import { describe, test, expect } from 'bun:test';
import { cryptoMarketCapTool } from './crypto-market-cap.js';

describe('cryptoMarketCapTool', () => {
  test('exposes the expected name and description', () => {
    expect(cryptoMarketCapTool.name).toBe('crypto_market_cap');
    expect(cryptoMarketCapTool.description.toLowerCase()).toContain('market cap');
  });

  test('schema applies default limit of 50', () => {
    const parsed = cryptoMarketCapTool.schema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.limit).toBe(50);
  });

  test('schema rejects limit > 250', () => {
    expect(cryptoMarketCapTool.schema.safeParse({ limit: 251 }).success).toBe(false);
  });

  test('schema rejects limit < 1', () => {
    expect(cryptoMarketCapTool.schema.safeParse({ limit: 0 }).success).toBe(false);
  });

  test('schema accepts known categories', () => {
    expect(
      cryptoMarketCapTool.schema.safeParse({ category: 'meme-token', limit: 10 }).success,
    ).toBe(true);
    expect(
      cryptoMarketCapTool.schema.safeParse({ category: 'layer-1', limit: 10 }).success,
    ).toBe(true);
  });

  test('schema rejects unknown category', () => {
    expect(
      cryptoMarketCapTool.schema.safeParse({ category: 'nonsense' }).success,
    ).toBe(false);
  });

  test('returns valid envelope on a small live call', async () => {
    const out = await cryptoMarketCapTool.invoke({ limit: 5 });
    expect(typeof out).toBe('string');
    const parsed = JSON.parse(out as string) as {
      data: { error?: string; coins?: Array<{ symbol?: string; rank?: number | null }>; count?: number };
    };
    if (parsed.data.error) return; // network / rate limit → accept envelope shape
    expect(parsed.data.count).toBe(5);
    expect(Array.isArray(parsed.data.coins)).toBe(true);
    expect(parsed.data.coins!.length).toBe(5);
    // BTC should be in the top 5 — sanity check on data quality
    const symbols = parsed.data.coins!.map((c) => c.symbol);
    expect(symbols).toContain('BTC');
  }, 20_000);
});
