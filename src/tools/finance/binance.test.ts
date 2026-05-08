import { describe, test, expect } from 'bun:test';
import { binancePriceTool, binanceKlinesTool, binanceTopMoversTool } from './binance.js';

describe('binancePriceTool', () => {
  test('exposes the expected name', () => {
    expect(binancePriceTool.name).toBe('binance_price');
  });

  test('schema accepts a valid symbol', () => {
    expect(binancePriceTool.schema.safeParse({ symbol: 'BTCUSDT' }).success).toBe(true);
  });

  test('schema rejects an empty symbol', () => {
    expect(binancePriceTool.schema.safeParse({ symbol: '' }).success).toBe(false);
  });

  test('schema rejects a missing symbol', () => {
    expect(binancePriceTool.schema.safeParse({}).success).toBe(false);
  });
});

describe('binanceKlinesTool', () => {
  test('schema applies defaults for interval and limit', () => {
    const parsed = binanceKlinesTool.schema.safeParse({ symbol: 'BTCUSDT' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.interval).toBe('1d');
      // Default tightened to 60 to fit the ~1.2k-token budget in CLAUDE.md.
      expect(parsed.data.limit).toBe(60);
    }
  });

  test('schema rejects an invalid interval', () => {
    expect(
      binanceKlinesTool.schema.safeParse({ symbol: 'BTCUSDT', interval: '2h' }).success,
    ).toBe(false);
  });

  test('schema clamps limit to [1, 200]', () => {
    expect(
      binanceKlinesTool.schema.safeParse({ symbol: 'BTCUSDT', limit: 0 }).success,
    ).toBe(false);
    expect(
      binanceKlinesTool.schema.safeParse({ symbol: 'BTCUSDT', limit: 201 }).success,
    ).toBe(false);
    expect(
      binanceKlinesTool.schema.safeParse({ symbol: 'BTCUSDT', limit: 100 }).success,
    ).toBe(true);
  });
});

describe('binanceTopMoversTool', () => {
  test('schema applies default direction and limit', () => {
    const parsed = binanceTopMoversTool.schema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.direction).toBe('gainers');
      expect(parsed.data.limit).toBe(10);
    }
  });

  test('schema rejects unknown direction', () => {
    expect(
      binanceTopMoversTool.schema.safeParse({ direction: 'sideways' }).success,
    ).toBe(false);
  });

  test('schema rejects limit > 100', () => {
    expect(
      binanceTopMoversTool.schema.safeParse({ limit: 101 }).success,
    ).toBe(false);
  });
});

describe('binance error handling', () => {
  test('binance_price returns a valid envelope on a malformed symbol', async () => {
    // Hit the real API with an obviously bogus symbol to exercise the catch branch.
    const out = await binancePriceTool.invoke({ symbol: '___NOT_A_SYMBOL___' });
    expect(typeof out).toBe('string');
    const parsed = JSON.parse(out as string) as { data: Record<string, unknown> };
    expect(parsed).toHaveProperty('data');
    expect(typeof parsed.data).toBe('object');
  }, 15_000);
});
