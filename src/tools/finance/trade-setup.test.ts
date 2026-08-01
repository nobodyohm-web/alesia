import { describe, test, expect } from 'bun:test';
import { buildLevels, chooseStrategy, scoreConfidence, tradeSetupTool } from './trade-setup.js';
import { analyzeTimeframe } from './market-read.js';
import { HORIZONS, HORIZON_DOCTRINE, type Horizon } from './horizons.js';
import { DEFAULT_THRESHOLDS } from './thresholds.js';
import { aggregateCandles, dropDuplicateWeeklyBar, resolveSymbol } from './candles.js';
import type { Candle } from './indicators.js';

/** Deterministic candle builder — no randomness, so failures are reproducible. */
function makeCandles(closes: number[], spreadPercent = 1, volume = 1_000_000): Candle[] {
  return closes.map((c, i) => {
    const spread = (c * spreadPercent) / 100;
    const day = new Date(Date.UTC(2026, 0, 1) + i * 86_400_000);
    return {
      date: day.toISOString(),
      open: c,
      high: c + spread / 2,
      low: c - spread / 2,
      close: c,
      volume,
    };
  });
}

/** A clean uptrend with periodic pullbacks — the textbook trend-pullback tape. */
const UPTREND = Array.from({ length: 220 }, (_, i) => 100 + i * 0.5 + Math.sin(i / 6) * 3);
const DOWNTREND = Array.from({ length: 220 }, (_, i) => 220 - i * 0.5 + Math.sin(i / 6) * 3);
/**
 * A genuinely trendless tape: two fast, incommensurate oscillations, which
 * measures ADX ~14. A single slow sine is NOT this — its half-cycles are long
 * and smooth enough to read as a strong trend (ADX ~56), which is exactly the
 * mistake that made an earlier version of this test assert the wrong thing.
 */
const RANGE = Array.from({ length: 220 }, (_, i) => 100 + 3 * Math.sin(i / 2.1) + 2 * Math.sin(i / 1.3));

const read = (closes: number[], spread = 1) => {
  const r = analyzeTimeframe(makeCandles(closes, spread));
  if (!r) throw new Error('expected a market read');
  return r;
};

describe('tradeSetupTool schema', () => {
  test('exposes the expected name', () => {
    expect(tradeSetupTool.name).toBe('trade_setup');
  });

  test('defaults to a swing horizon with automatic direction and 1% risk', () => {
    const parsed = tradeSetupTool.schema.safeParse({ symbol: 'NVDA' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.horizon).toBe('swing');
      expect(parsed.data.direction).toBe('auto');
      expect(parsed.data.riskPercent).toBe(1);
    }
  });

  test('rejects a risk budget outside the sane band', () => {
    expect(tradeSetupTool.schema.safeParse({ symbol: 'NVDA', riskPercent: 0 }).success).toBe(false);
    expect(tradeSetupTool.schema.safeParse({ symbol: 'NVDA', riskPercent: 50 }).success).toBe(false);
  });
});

describe('horizon specifications', () => {
  const horizons = Object.keys(HORIZONS) as Horizon[];

  test('every horizon has a doctrine line', () => {
    for (const h of horizons) expect(HORIZON_DOCTRINE[h].length).toBeGreaterThan(20);
  });

  test('the stop buffer always fits inside its own ceiling', () => {
    // Otherwise the cap would fire on every single setup, which would mean the
    // structural stop is dead code.
    for (const h of horizons) {
      expect(HORIZONS[h].stopAtrMultiple).toBeLessThan(HORIZONS[h].maxStopAtr);
    }
  });

  test('required reward:risk rises with the horizon', () => {
    expect(HORIZONS.day.minRiskReward).toBeLessThan(HORIZONS.swing.minRiskReward);
    expect(HORIZONS.swing.minRiskReward).toBeLessThan(HORIZONS.medium.minRiskReward);
    expect(HORIZONS.medium.minRiskReward).toBeLessThan(HORIZONS.long.minRiskReward);
  });

  test('stops widen with the horizon', () => {
    expect(HORIZONS.day.stopAtrMultiple).toBeLessThan(HORIZONS.swing.stopAtrMultiple);
    expect(HORIZONS.swing.stopAtrMultiple).toBeLessThan(HORIZONS.medium.stopAtrMultiple);
    expect(HORIZONS.medium.stopAtrMultiple).toBeLessThan(HORIZONS.long.stopAtrMultiple);
  });
});

describe('chooseStrategy', () => {
  test('never trend-follows a trendless market', () => {
    const r = read(RANGE);
    expect(r.trend.strength ?? 0).toBeLessThan(20);
    const { strategy, timing } = chooseStrategy('long', r, r);
    // With no trend the only honest options are mean reversion at an extreme,
    // a compression breakout, or nothing at all. Never a trend-pullback.
    expect(strategy).not.toBe('trend-pullback');
    if (strategy === 'none') expect(timing).toBe('stand-aside');
  });

  test('takes the mean-reversion side at the bottom of a trendless range', () => {
    const r = read(RANGE);
    expect(r.levels.rangePosition ?? 1).toBeLessThan(0.3);
    expect(chooseStrategy('long', r, r).strategy).toBe('range-reversion');
  });

  test('takes the pullback side of an established uptrend', () => {
    const r = read(UPTREND);
    const { strategy } = chooseStrategy('long', r, r);
    expect(['trend-pullback', 'breakout']).toContain(strategy);
  });

  test('refuses to go long against an established downtrend', () => {
    const r = read(DOWNTREND);
    const { strategy, timing } = chooseStrategy('long', r, r);
    // Either stand aside, or a mean-reversion buy at the low of the range —
    // never a trend-following long into a downtrend.
    expect(strategy).not.toBe('trend-pullback');
    if (strategy === 'none') expect(timing).toBe('stand-aside');
  });
});

describe('buildLevels', () => {
  const spec = HORIZONS.swing;

  test('a long stop sits below the entry and targets above it', () => {
    const r = read(UPTREND);
    const { entry, stop, targets } = buildLevels('long', 'trend-pullback', r, makeCandles(UPTREND), spec, 3);
    expect(entry).not.toBeNull();
    expect(stop).not.toBeNull();
    if (!entry || !stop) return;
    expect(stop.price).toBeLessThan(entry.ideal);
    for (const t of targets) expect(t.price).toBeGreaterThan(entry.ideal);
  });

  test('a short stop sits above the entry and targets below it', () => {
    const r = read(DOWNTREND);
    const { entry, stop, targets } = buildLevels('short', 'trend-pullback', r, makeCandles(DOWNTREND), spec, 3);
    expect(entry).not.toBeNull();
    if (!entry || !stop) return;
    expect(stop.price).toBeGreaterThan(entry.ideal);
    for (const t of targets) expect(t.price).toBeLessThan(entry.ideal);
  });

  test('targets are ordered by increasing R', () => {
    const r = read(UPTREND);
    const { targets } = buildLevels('long', 'trend-pullback', r, makeCandles(UPTREND), spec, 3);
    for (let i = 1; i < targets.length; i++) {
      expect(targets[i].rMultiple).toBeGreaterThan(targets[i - 1].rMultiple);
    }
  });

  test('never emits a target at or below zero', () => {
    // Regression guard: a wide stop on a short once produced T2 = -36,183.
    // Nothing trades at a negative price.
    for (const h of Object.keys(HORIZONS) as Horizon[]) {
      for (const closes of [UPTREND, DOWNTREND, RANGE]) {
        for (const dir of ['long', 'short'] as const) {
          const { targets } = buildLevels(dir, 'trend-pullback', read(closes), makeCandles(closes), HORIZONS[h], 3);
          for (const t of targets) expect(t.price).toBeGreaterThan(0);
        }
      }
    }
  });

  test('the stop never exceeds the horizon ceiling in ATR or in percent', () => {
    for (const h of Object.keys(HORIZONS) as Horizon[]) {
      const s = HORIZONS[h];
      for (const closes of [UPTREND, DOWNTREND, RANGE]) {
        for (const dir of ['long', 'short'] as const) {
          const { stop } = buildLevels(dir, 'trend-pullback', read(closes), makeCandles(closes), s, 3);
          if (!stop) continue;
          // Rounding to 2 decimals can nudge the reported figure a hair past
          // the limit; allow that but nothing more.
          expect(stop.distanceAtr).toBeLessThanOrEqual(s.maxStopAtr + 0.01);
          expect(stop.distancePercent).toBeLessThanOrEqual(s.maxStopPercent + 0.01);
        }
      }
    }
  });

  test('flags when the stop had to fall back to volatility', () => {
    // A tape whose only structure is far away forces the cap on a day horizon,
    // whose ceiling is deliberately tight (3 ATR / 3%).
    const r = read(UPTREND, 0.2);
    const { stop } = buildLevels('long', 'trend-pullback', r, makeCandles(UPTREND, 0.2), HORIZONS.day, 3);
    if (stop?.structuralCapped) {
      expect(stop.method).toContain('volatility stop');
    }
    // Either way the field must exist so callers can branch on it.
    expect(stop === null || typeof stop.structuralCapped === 'boolean').toBe(true);
  });
});

describe('scoreConfidence', () => {
  const spec = HORIZONS.swing;

  test('stays within 0-100 and sums its factors', () => {
    const up = read(UPTREND);
    const { score, factors } = scoreConfidence('long', 'trend-pullback', up, up, up, 3, spec, false, false);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
    const sum = factors.reduce((a, f) => a + f.points, 0);
    expect(score).toBe(Math.max(0, Math.min(100, sum)));
  });

  test('scores an aligned trade above a counter-trend one', () => {
    const up = read(UPTREND);
    const down = read(DOWNTREND);
    const aligned = scoreConfidence('long', 'trend-pullback', up, up, up, 3, spec, false, false).score;
    const against = scoreConfidence('long', 'trend-pullback', down, down, down, 3, spec, true, false).score;
    expect(aligned).toBeGreaterThan(against);
  });

  test('a volatility-capped stop costs confidence', () => {
    const up = read(UPTREND);
    const clean = scoreConfidence('long', 'trend-pullback', up, up, up, 3, spec, false, false).score;
    const capped = scoreConfidence('long', 'trend-pullback', up, up, up, 3, spec, false, true).score;
    expect(capped).toBeLessThan(clean);
  });

  test('a drift-only bias earns less than an ADX-confirmed one', () => {
    // The calibration bug this pins: a chart with ADX 15 once scored full
    // marks for "higher-timeframe bias" purely from a regression slope.
    const up = read(UPTREND);
    const drift = {
      ...up,
      trend: { ...up.trend, direction: 'up' as const, directionSource: 'slope' as const, strength: 15 },
    };
    const confirmed = {
      ...up,
      trend: { ...up.trend, direction: 'up' as const, directionSource: 'adx' as const, strength: 30 },
    };
    const driftScore = scoreConfidence('long', 'trend-pullback', drift, up, up, 3, spec, false, false).score;
    const confirmedScore = scoreConfidence('long', 'trend-pullback', confirmed, up, up, 3, spec, false, false).score;
    expect(driftScore).toBeLessThan(confirmedScore);
  });

  test('every factor stays within its own maximum', () => {
    const up = read(UPTREND);
    const { factors } = scoreConfidence('long', 'trend-pullback', up, up, up, 3, spec, false, false);
    for (const f of factors) {
      if (f.max > 0) expect(f.points).toBeLessThanOrEqual(f.max);
    }
  });
});

describe('symbol resolution', () => {
  test('routes bare crypto tickers to a Binance pair', () => {
    expect(resolveSymbol('BTC')).toEqual({ symbol: 'BTCUSDT', market: 'crypto', input: 'BTC' });
    expect(resolveSymbol('eth')).toEqual({ symbol: 'ETHUSDT', market: 'crypto', input: 'ETH' });
  });

  test('keeps an explicit pair as-is', () => {
    expect(resolveSymbol('SOLUSDT').symbol).toBe('SOLUSDT');
    expect(resolveSymbol('BTCUSDC').market).toBe('crypto');
  });

  test('translates the Yahoo crypto notation', () => {
    expect(resolveSymbol('BTC-USD')).toEqual({ symbol: 'BTCUSDT', market: 'crypto', input: 'BTC-USD' });
  });

  test('treats unknown short tickers as equities', () => {
    // Plenty of equity tickers look like crypto names; only an explicit quote
    // suffix or a known coin should route to Binance.
    expect(resolveSymbol('NVDA').market).toBe('equity');
    expect(resolveSymbol('F').market).toBe('equity');
    expect(resolveSymbol('MSTR').market).toBe('equity');
  });

  test('an explicit market overrides the heuristic', () => {
    expect(resolveSymbol('BTC', 'equity').market).toBe('equity');
    expect(resolveSymbol('NVDA', 'crypto').symbol).toBe('NVDAUSDT');
  });
});

describe('aggregateCandles', () => {
  const bars = (dates: string[]): Candle[] =>
    dates.map((d, i) => ({ date: d, open: i, high: i + 1, low: i - 1, close: i, volume: 10 }));

  test('merges OHLCV correctly', () => {
    const merged = aggregateCandles(makeCandles([10, 12, 8, 11]), 4);
    expect(merged).toHaveLength(1);
    expect(merged[0].open).toBe(10);
    expect(merged[0].close).toBe(11);
    expect(merged[0].volume).toBe(4_000_000);
  });

  test('session-aware aggregation never merges across days', () => {
    // Two sessions of three hourly bars each, grouped by 4. Without the daily
    // reset, bar 4 of day one would be welded to bar 1 of day two, producing a
    // "4h bar" spanning a whole overnight gap.
    const input = bars([
      '2026-01-01T13:30:00Z', '2026-01-01T14:30:00Z', '2026-01-01T15:30:00Z',
      '2026-01-02T13:30:00Z', '2026-01-02T14:30:00Z', '2026-01-02T15:30:00Z',
    ]);
    const out = aggregateCandles(input, 4, true);
    expect(out).toHaveLength(2);
    expect(out[0].date.slice(0, 10)).toBe('2026-01-01');
    expect(out[1].date.slice(0, 10)).toBe('2026-01-02');
  });

  test('non-session aggregation does weld across days', () => {
    const input = bars([
      '2026-01-01T13:30:00Z', '2026-01-01T14:30:00Z', '2026-01-01T15:30:00Z',
      '2026-01-02T13:30:00Z', '2026-01-02T14:30:00Z', '2026-01-02T15:30:00Z',
    ]);
    expect(aggregateCandles(input, 4, false)).toHaveLength(2);
    expect(aggregateCandles(input, 4, false)[0].date.slice(0, 10)).toBe('2026-01-01');
  });

  test('a factor of 1 or less is a passthrough', () => {
    const input = makeCandles([1, 2, 3]);
    expect(aggregateCandles(input, 1)).toHaveLength(3);
  });

  test('splits a full session into whole buckets', () => {
    // Seven hourly bars (a US cash session) chunked by 4 gives 4+3.
    const day = bars(Array.from({ length: 7 }, (_, i) => `2026-01-01T${String(13 + i).padStart(2, '0')}:30:00Z`));
    const out = aggregateCandles(day, 4, true);
    expect(out).toHaveLength(2);
  });
});

describe('dropDuplicateWeeklyBar', () => {
  const wk = (date: string, high: number, volume: number): Candle => ({
    date, open: 100, high, low: 90, close: 95, volume,
  });

  test('drops the trailing bar that repeats the current week', () => {
    // The exact shape Yahoo returns: the real Monday-dated aggregate carrying
    // the whole week's range and volume, followed by a bar for the same week
    // holding only the final session — which silently truncates the week high.
    const out = dropDuplicateWeeklyBar([
      wk('2026-07-20T00:00:00Z', 334.37, 221_893_000),
      wk('2026-07-27T00:00:00Z', 344.57, 364_647_200),
      wk('2026-07-31T00:00:00Z', 310.69, 127_398_021),
    ]);
    expect(out).toHaveLength(2);
    expect(out[out.length - 1].high).toBe(344.57);
  });

  test('keeps distinct weeks untouched', () => {
    const out = dropDuplicateWeeklyBar([
      wk('2026-07-20T00:00:00Z', 1, 10),
      wk('2026-07-27T00:00:00Z', 2, 20),
    ]);
    expect(out).toHaveLength(2);
  });

  test('keeps the fuller bar when the duplicate arrives first', () => {
    // Volume decides, not order: the true weekly bar holds every session.
    const out = dropDuplicateWeeklyBar([
      wk('2026-07-27T00:00:00Z', 310.69, 127_398_021),
      wk('2026-07-31T00:00:00Z', 344.57, 364_647_200),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].high).toBe(344.57);
  });

  test('treats Sunday as belonging to the week that just ended', () => {
    // getUTCDay returns 0 for Sunday; a naive 1 - day shift would file it
    // under the following Monday and miss the duplicate entirely.
    const out = dropDuplicateWeeklyBar([
      wk('2026-07-27T00:00:00Z', 5, 100),
      wk('2026-08-02T00:00:00Z', 4, 50), // Sunday of the same week
    ]);
    expect(out).toHaveLength(1);
  });

  test('is a no-op on a single bar', () => {
    expect(dropDuplicateWeeklyBar([wk('2026-07-27T00:00:00Z', 1, 1)])).toHaveLength(1);
  });
});

describe('extension guard', () => {
  // Regression: this threshold was inert. Both branches returned
  // trend-pullback and differed only in timing, but `stretched` requires
  // distance > stretchedAtr while `nearMean` requires distance <= nearMeanAtr —
  // conditions that cannot both hold. A sweep proved it: stretchedAtr at 1.0,
  // 1.5, 2.0 and 3.0 produced byte-identical trade sets.
  const trendingRead = read(UPTREND);

  test('the threshold actually changes the outcome', () => {
    const strict = chooseStrategy('long', trendingRead, trendingRead, {
      ...DEFAULT_THRESHOLDS,
      stretchedAtr: 0.01,
    });
    const loose = chooseStrategy('long', trendingRead, trendingRead, {
      ...DEFAULT_THRESHOLDS,
      stretchedAtr: 999,
    });
    expect(strict.strategy).not.toBe(loose.strategy);
  });

  test('a parabolic extension stands aside rather than offering an entry', () => {
    const strict = chooseStrategy('long', trendingRead, trendingRead, {
      ...DEFAULT_THRESHOLDS,
      stretchedAtr: 0.01,
    });
    expect(strict.strategy).toBe('none');
    expect(strict.timing).toBe('stand-aside');
    expect(strict.reason).toContain('ATR from its EMA20');
  });

  test('a normal distance from the mean still produces a setup', () => {
    const loose = chooseStrategy('long', trendingRead, trendingRead, {
      ...DEFAULT_THRESHOLDS,
      stretchedAtr: 999,
    });
    expect(loose.strategy).not.toBe('none');
  });
});
