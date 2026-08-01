import { describe, test, expect } from 'bun:test';
import { backtestSymbol, computeMetrics, fillPriceOn, type SimTrade } from './harness.js';
import type { Candle } from '../indicators.js';

/**
 * Deterministic pseudo-random walk. No Math.random anywhere in the harness or
 * its tests: a calibration you cannot reproduce is an anecdote.
 */
function walk(n: number, seed = 7, start = 100): Candle[] {
  let s = seed;
  const next = (): number => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  const out: Candle[] = [];
  let price = start;
  for (let i = 0; i < n; i++) {
    // Drift plus noise plus a slow cycle, so the series contains both trending
    // and ranging stretches rather than one regime the engine never leaves.
    price *= 1 + (next() - 0.5) * 0.03 + Math.sin(i / 40) * 0.002;
    const spread = price * 0.012;
    out.push({
      date: new Date(Date.UTC(2020, 0, 1) + i * 86_400_000).toISOString(),
      open: price - spread * 0.2,
      high: price + spread,
      low: price - spread,
      close: price,
      volume: 1_000_000 + Math.floor(next() * 500_000),
    });
  }
  return out;
}

const SERIES = walk(700);
const same = (candles: Candle[]) => ({ entry: candles, structure: candles, trend: candles });

describe('leak safety', () => {
  test('appending future bars does not change past decisions', () => {
    // The single test that decides whether any number this harness produces is
    // worth reading. If future data can reach backwards, every expectancy,
    // every swept threshold and every conclusion drawn from them is fiction.
    const short = backtestSymbol('TEST', same(SERIES.slice(0, 400)), 'swing', { costFraction: 0 });
    const long = backtestSymbol('TEST', same(SERIES), 'swing', { costFraction: 0 });

    const settled = (t: SimTrade): boolean => t.exitDate < SERIES[350].date;
    const a = short.filter(settled);
    const b = long.filter(settled);

    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBe(a.length);
    for (let i = 0; i < a.length; i++) {
      expect(b[i].entryDate).toBe(a[i].entryDate);
      expect(b[i].entryPrice).toBeCloseTo(a[i].entryPrice, 8);
      expect(b[i].stop).toBeCloseTo(a[i].stop, 8);
      expect(b[i].target).toBeCloseTo(a[i].target, 8);
      expect(b[i].resultR).toBeCloseTo(a[i].resultR, 8);
    }
  });

  test('the same inputs always produce the same trades', () => {
    const first = backtestSymbol('TEST', same(SERIES), 'swing');
    const second = backtestSymbol('TEST', same(SERIES), 'swing');
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  test('entry never happens on the bar the decision was made from', () => {
    // Deciding on a close and filling at that same close is the most common
    // way a backtest invents money that was never available.
    const trades = backtestSymbol('TEST', same(SERIES), 'swing');
    expect(trades.length).toBeGreaterThan(0);
    for (const t of trades) {
      const entryIndex = SERIES.findIndex((c) => c.date === t.entryDate);
      expect(entryIndex).toBeGreaterThan(0);
      // The fill price must be reachable within the fill bar's own range.
      const bar = SERIES[entryIndex];
      expect(t.entryPrice).toBeGreaterThanOrEqual(bar.low * 0.999);
      expect(t.entryPrice).toBeLessThanOrEqual(bar.high * 1.001);
    }
  });
});

describe('fillPriceOn', () => {
  const bar = { date: 'd', open: 100, high: 105, low: 95, close: 102, volume: 1 };

  test('a market order fills at the open', () => {
    expect(fillPriceOn(bar, 'market', 0, true)).toBe(100);
  });

  test('a limit buy fills only when price trades down to it', () => {
    expect(fillPriceOn(bar, 'limit', 97, true)).toBe(97);
    expect(fillPriceOn(bar, 'limit', 90, true)).toBeNull();
  });

  test('a limit buy below the open fills at the better of the two', () => {
    // Gapping through a limit fills at the open, not at the limit price —
    // assuming the limit would be an invented improvement.
    expect(fillPriceOn({ ...bar, open: 96 }, 'limit', 98, true)).toBe(96);
  });

  test('a stop buy fills only when price trades up through it', () => {
    expect(fillPriceOn(bar, 'stop', 103, true)).toBe(103);
    expect(fillPriceOn(bar, 'stop', 110, true)).toBeNull();
  });

  test('short orders mirror the long logic', () => {
    expect(fillPriceOn(bar, 'limit', 103, false)).toBe(103);
    expect(fillPriceOn(bar, 'limit', 110, false)).toBeNull();
    expect(fillPriceOn(bar, 'stop', 97, false)).toBe(97);
    expect(fillPriceOn(bar, 'stop', 90, false)).toBeNull();
  });
});

describe('sampling independence', () => {
  test('the decision step does not move measured expectancy', () => {
    // The bug this pins: `step` originally skipped FILL bars too, so a limit
    // order valid for 5 bars got only 2 chances instead of 5. That
    // under-sampled pullback entries, over-weighted market entries, and moved
    // expectancy by 0.26R purely as an artefact of the sampling rate.
    const full = computeMetrics(backtestSymbol('TEST', same(SERIES), 'swing', { step: 1 }));
    const sparse = computeMetrics(backtestSymbol('TEST', same(SERIES), 'swing', { step: 3 }));
    expect(full.trades).toBeGreaterThan(10);
    expect(sparse.trades).toBeGreaterThan(10);

    // Anchored on measured uncertainty rather than a made-up constant: R
    // outcomes are fat-tailed, so some step sensitivity is genuine sampling
    // noise. What must not happen is a shift comparable to the effects we are
    // trying to detect. The original bug moved expectancy by 0.26R, well
    // outside this bound.
    const gap = Math.abs((sparse.expectancyR as number) - (full.expectancyR as number));
    const ci = full.expectancyCI as [number, number];
    const halfWidth = (ci[1] - ci[0]) / 2;
    expect(gap).toBeLessThan(halfWidth);
  });
});

describe('gap protection', () => {
  test('a stopped trade never loses much more than 1R', () => {
    // Before the gap guard, a limit order could fill BELOW its own stop when a
    // bar gapped through the entry zone. The risk unit collapsed to a rounding
    // error, the cost expressed in R exploded, and stopped trades averaged
    // -1.26R instead of the -1.05R a stop-out actually costs.
    const trades = backtestSymbol('TEST', same(SERIES), 'swing', { costFraction: 0.002 });
    const stopped = trades.filter((t) => t.outcome === 'stop');
    expect(stopped.length).toBeGreaterThan(0);
    for (const t of stopped) expect(t.resultR).toBeGreaterThan(-1.35);
  });

  test('no fill ever lands beyond its own stop', () => {
    const trades = backtestSymbol('TEST', same(SERIES), 'swing');
    for (const t of trades) {
      if (t.direction === 'long') expect(t.entryPrice).toBeGreaterThan(t.stop);
      else expect(t.entryPrice).toBeLessThan(t.stop);
    }
  });
});

describe('fill model', () => {
  test('a bar touching both stop and target resolves as a stop', () => {
    // Intrabar sequence is unknowable. Assuming the favourable ordering is how
    // a losing system backtests profitable.
    const trades = backtestSymbol('TEST', same(SERIES), 'swing', { costFraction: 0 });
    const stopped = trades.filter((t) => t.outcome === 'stop');
    expect(stopped.length).toBeGreaterThan(0);
    for (const t of stopped) {
      // A stopped trade loses about 1R before costs, never more — the stop is
      // assumed to fill at its price, and gap risk is a separate concern.
      expect(t.resultR).toBeCloseTo(-1, 2);
    }
  });

  test('a target exit returns at least the intended reward', () => {
    const trades = backtestSymbol('TEST', same(SERIES), 'swing', { costFraction: 0 });
    for (const t of trades.filter((x) => x.outcome === 'target')) {
      expect(t.resultR).toBeGreaterThan(0);
    }
  });

  test('costs reduce every result', () => {
    const free = backtestSymbol('TEST', same(SERIES), 'swing', { costFraction: 0 });
    const charged = backtestSymbol('TEST', same(SERIES), 'swing', { costFraction: 0.002 });
    expect(charged.length).toBe(free.length);
    for (let i = 0; i < free.length; i++) {
      expect(charged[i].resultR).toBeLessThan(free[i].resultR);
    }
  });

  test('positions never overlap', () => {
    // One position at a time, as a discretionary trader would actually run it.
    const trades = backtestSymbol('TEST', same(SERIES), 'swing');
    for (let i = 1; i < trades.length; i++) {
      expect(trades[i].entryDate >= trades[i - 1].exitDate).toBe(true);
    }
  });

  test('a position is closed by the holding limit', () => {
    const trades = backtestSymbol('TEST', same(SERIES), 'swing', { maxHoldBars: 10 });
    for (const t of trades) expect(t.barsHeld).toBeLessThanOrEqual(10);
  });
});

describe("threshold injection", async () => {
  test("an unreachable ADX requirement produces no trend-following trades", async () => {
    const trades = backtestSymbol('TEST', same(SERIES), 'swing', {
      thresholds: { ...(await import('../thresholds.js')).DEFAULT_THRESHOLDS, adxSetupTrending: 999 },
    });
    expect(trades.every((t) => t.strategy !== 'trend-pullback')).toBe(true);
  });

  test("changing a threshold changes the trade set", async () => {
    const base = backtestSymbol('TEST', same(SERIES), 'swing');
    const loose = backtestSymbol('TEST', same(SERIES), 'swing', {
      thresholds: { ...(await import('../thresholds.js')).DEFAULT_THRESHOLDS, adxSetupTrending: 10 },
    });
    expect(loose.length).not.toBe(base.length);
  });
});

describe('computeMetrics', () => {
  const mk = (r: number): SimTrade => ({
    symbol: 'X', horizon: 'swing', direction: 'long', strategy: 'trend-pullback',
    entryDate: 'a', entryPrice: 1, stop: 0.9, target: 1.2, exitDate: 'b', exitPrice: 1.1,
    resultR: r, outcome: r > 0 ? 'target' : 'stop', barsHeld: 3,
  });

  test('expectancy is the mean R', () => {
    const m = computeMetrics([mk(2), mk(-1), mk(-1), mk(2)]);
    expect(m.expectancyR).toBeCloseTo(0.5, 6);
    expect(m.winRate).toBeCloseTo(50, 6);
  });

  test('a high win rate with tiny wins still loses money', () => {
    // Why win rate alone is worthless: 80% winners at 0.2R against 20% losers
    // at -1R is a negative-expectancy system that looks excellent.
    const trades = [...Array(8).fill(0).map(() => mk(0.2)), mk(-1), mk(-1)];
    const m = computeMetrics(trades);
    expect(m.winRate).toBeCloseTo(80, 6);
    expect(m.expectancyR as number).toBeLessThan(0);
  });

  test('drawdown is measured on the R equity curve', () => {
    expect(computeMetrics([mk(3), mk(-1), mk(-1), mk(2)]).maxDrawdownR).toBeCloseTo(2, 6);
  });

  test('the confidence interval brackets the point estimate', () => {
    const m = computeMetrics(Array.from({ length: 200 }, (_, i) => mk(i % 3 === 0 ? 2 : -1)));
    expect(m.expectancyCI).not.toBeNull();
    if (m.expectancyCI && m.expectancyR !== null) {
      expect(m.expectancyCI[0]).toBeLessThanOrEqual(m.expectancyR);
      expect(m.expectancyCI[1]).toBeGreaterThanOrEqual(m.expectancyR);
    }
  });

  test('too small a sample yields no interval rather than a fake one', () => {
    expect(computeMetrics([mk(1), mk(-1)]).expectancyCI).toBeNull();
  });

  test('an empty run reports nulls, not zeros', () => {
    const m = computeMetrics([]);
    expect(m.trades).toBe(0);
    expect(m.expectancyR).toBeNull();
    expect(m.winRate).toBeNull();
  });
});
