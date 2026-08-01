import { describe, test, expect } from 'bun:test';
import { analyzeTimeframe } from './market-read.js';
import { technicalAnalysisTool } from './technical-analysis.js';
import type { Candle } from './indicators.js';

function makeCandles(closes: number[], spreadPercent = 1, volume = 1_000_000): Candle[] {
  return closes.map((c, i) => {
    const spread = (c * spreadPercent) / 100;
    return {
      date: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString(),
      open: c,
      high: c + spread / 2,
      low: c - spread / 2,
      close: c,
      volume,
    };
  });
}

const UPTREND = Array.from({ length: 220 }, (_, i) => 100 + i * 0.5 + Math.sin(i / 6) * 3);
const DOWNTREND = Array.from({ length: 220 }, (_, i) => 220 - i * 0.5 + Math.sin(i / 6) * 3);
const CHOP = Array.from({ length: 220 }, (_, i) => 100 + 3 * Math.sin(i / 2.1) + 2 * Math.sin(i / 1.3));

describe('technicalAnalysisTool schema', () => {
  test('exposes the expected name', () => {
    expect(technicalAnalysisTool.name).toBe('technical_analysis');
  });

  test('defaults to the daily timeframe', () => {
    const parsed = technicalAnalysisTool.schema.safeParse({ symbol: 'NVDA' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.timeframes).toEqual(['1d']);
  });

  test('rejects an unsupported timeframe', () => {
    expect(technicalAnalysisTool.schema.safeParse({ symbol: 'NVDA', timeframes: ['3s'] }).success).toBe(false);
  });
});

describe('analyzeTimeframe', () => {
  test('refuses to read a series too short to mean anything', () => {
    // A partial read invites the model to trust an EMA50 that is really just
    // its own seed value.
    expect(analyzeTimeframe(makeCandles([1, 2, 3]))).toBeNull();
    expect(analyzeTimeframe(makeCandles(Array.from({ length: 29 }, (_, i) => 100 + i)))).toBeNull();
  });

  test('reads an uptrend as up, ADX-confirmed', () => {
    const r = analyzeTimeframe(makeCandles(UPTREND));
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.trend.direction).toBe('up');
    expect(r.trend.directionSource).toBe('adx');
    expect(r.trend.strength ?? 0).toBeGreaterThan(25);
    expect(r.regime).toBe('trending');
  });

  test('reads a downtrend as down', () => {
    const r = analyzeTimeframe(makeCandles(DOWNTREND));
    if (!r) return;
    expect(r.trend.direction).toBe('down');
    expect(r.trend.maRegime).toBe('death');
  });

  test('marks a trendless tape as sideways with no direction source', () => {
    const r = analyzeTimeframe(makeCandles(CHOP));
    if (!r) return;
    expect(r.trend.direction).toBe('sideways');
    expect(r.trend.directionSource).toBe('none');
    expect(r.trend.strength ?? 99).toBeLessThan(20);
  });

  test('splits support below and resistance above the current price', () => {
    const r = analyzeTimeframe(makeCandles(CHOP));
    if (!r) return;
    for (const l of r.levels.support) expect(l.price).toBeLessThan(r.price);
    for (const l of r.levels.resistance) expect(l.price).toBeGreaterThanOrEqual(r.price);
  });

  test('range position stays within 0 and 1', () => {
    for (const series of [UPTREND, DOWNTREND, CHOP]) {
      const r = analyzeTimeframe(makeCandles(series));
      if (!r || r.levels.rangePosition === null) continue;
      expect(r.levels.rangePosition).toBeGreaterThanOrEqual(0);
      expect(r.levels.rangePosition).toBeLessThanOrEqual(1);
    }
  });

  test('every signal is a non-empty string', () => {
    const r = analyzeTimeframe(makeCandles(UPTREND));
    if (!r) return;
    for (const s of r.signals) expect(s.length).toBeGreaterThan(0);
  });

  test('reports no volume trend when the series carries no volume', () => {
    // Some indices arrive with zero volume; inventing accumulation from that
    // would be a fabricated signal.
    const r = analyzeTimeframe(makeCandles(UPTREND, 1, 0));
    if (!r) return;
    expect(r.volume.obvTrend).toBeNull();
  });

  test('annualised volatility scales with the bars-per-year convention', () => {
    // The same tape read as weekly bars must not report the same annualised
    // figure as daily bars — that is what the parameter is for.
    const daily = analyzeTimeframe(makeCandles(UPTREND), 252);
    const weekly = analyzeTimeframe(makeCandles(UPTREND), 52);
    if (!daily?.volatility.annualisedVolatility || !weekly?.volatility.annualisedVolatility) return;
    expect(daily.volatility.annualisedVolatility).toBeGreaterThan(weekly.volatility.annualisedVolatility);
  });

  test('price matches the last close', () => {
    const r = analyzeTimeframe(makeCandles(UPTREND));
    if (!r) return;
    expect(r.price).toBeCloseTo(UPTREND[UPTREND.length - 1], 2);
  });
});
