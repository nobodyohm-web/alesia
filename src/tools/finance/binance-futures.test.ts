import { describe, test, expect } from 'bun:test';
import { annualisedFunding, inferFundingIntervalHours, binanceFuturesTool } from './binance-futures.js';

describe('binanceFuturesTool', () => {
  test('exposes the expected name', () => {
    expect(binanceFuturesTool.name).toBe('binance_futures_positioning');
  });

  test('schema applies defaults', () => {
    const parsed = binanceFuturesTool.schema.safeParse({ symbol: 'BTCUSDT' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.period).toBe('1d');
      expect(parsed.data.limit).toBe(14);
    }
  });

  test('schema requires a symbol and rejects an unknown period', () => {
    expect(binanceFuturesTool.schema.safeParse({}).success).toBe(false);
    expect(binanceFuturesTool.schema.safeParse({ symbol: 'BTCUSDT', period: '2h' }).success).toBe(false);
  });
});

// Binance quotes funding per 8-hour settlement; an annual figure is what makes
// the carry cost comparable to a rate, so the factor is 3 settlements x 365 days.
describe('annualisedFunding', () => {
  test('compounds the 8-hour rate over a year', () => {
    expect(annualisedFunding(0.0001)).toBeCloseTo(10.95, 2);
    expect(annualisedFunding(0.00003163)).toBeCloseTo(3.46, 2);
  });

  test('keeps the sign of a negative (crowded short) funding rate', () => {
    expect(annualisedFunding(-0.0001)).toBeCloseTo(-10.95, 2);
  });

  test('returns zero for a flat rate', () => {
    expect(annualisedFunding(0)).toBe(0);
  });
});

describe('annualisedFunding', () => {
  test('an 8-hour rate compounds three times a day', () => {
    expect(annualisedFunding(0.0001, 8)).toBeCloseTo(10.95, 2);
  });

  test('a 4-hour rate annualises to exactly double the 8-hour figure', () => {
    // 126 of Binance's 208 perpetuals settle every 4 hours. Assuming 8h — as
    // this function originally did — halves the reported cost on most altcoins.
    expect(annualisedFunding(0.0001, 4)).toBeCloseTo(2 * annualisedFunding(0.0001, 8), 6);
  });

  test('defaults to 8 hours when the interval is unknown', () => {
    expect(annualisedFunding(0.0001)).toBe(annualisedFunding(0.0001, 8));
  });

  test('keeps the sign of a negative rate', () => {
    expect(annualisedFunding(-0.0001, 8)).toBeLessThan(0);
  });
});

describe('inferFundingIntervalHours', () => {
  const H = 3_600_000;
  const series = (hours: number, n = 10): number[] =>
    Array.from({ length: n }, (_, i) => 1_700_000_000_000 + i * hours * H);

  test('recovers 8h and 4h cadences from timestamps', () => {
    expect(inferFundingIntervalHours(series(8))).toBe(8);
    expect(inferFundingIntervalHours(series(4))).toBe(4);
    expect(inferFundingIntervalHours(series(1))).toBe(1);
  });

  test('a single missed settlement does not skew the median', () => {
    const t = series(8);
    t.splice(5, 1); // one 16h gap in an otherwise 8h series
    expect(inferFundingIntervalHours(t)).toBe(8);
  });

  test('falls back to 8h when there is nothing to measure', () => {
    expect(inferFundingIntervalHours([])).toBe(8);
    expect(inferFundingIntervalHours([1_700_000_000_000])).toBe(8);
  });

  test('snaps a slightly irregular cadence to the nearest real interval', () => {
    // Exchanges settle on fixed clock boundaries; a 4.1h median is clock drift,
    // not a 4.1-hour funding interval.
    const t = [0, 4.1, 8.2, 12.05].map((h) => 1_700_000_000_000 + h * H);
    expect(inferFundingIntervalHours(t)).toBe(4);
  });
});
