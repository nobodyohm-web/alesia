import { describe, test, expect } from 'bun:test';
import { chooseStrategy, type Strategy, type Timing, type Direction } from './trade-setup.js';
import { analyzeTimeframe, type Regime } from './market-read.js';
import { DEFAULT_THRESHOLDS } from './thresholds.js';
import type { Candle } from './indicators.js';

/**
 * Reachability guard — every declared outcome must actually be producible.
 *
 * Two branches of this engine shipped as dead code and were only caught by
 * accident during a backtest:
 *
 *   - `stretchedAtr` could never change an outcome, because `stretched`
 *     (distance > 2 ATR) and `nearMean` (distance <= 1 ATR) cannot both hold.
 *     Four different values produced byte-identical results.
 *   - `reversal` demanded a long bias in an oversold market — conditions that
 *     exclude each other by construction, since the bias is derived from the
 *     very trend producing the RSI reading. It fired 0 times in 3,011 bars.
 *
 * Neither was visible to code review, type checking, or any unit test, because
 * each branch was individually correct; only the combination was impossible.
 * This file turns that class of defect into a test failure: if a declared
 * Strategy, Timing or Regime cannot be produced from ANY market state in the
 * corpus below, something is unreachable and the reader deserves to know.
 */

function candles(closes: number[], spreadPercent = 1, volume = 1_000_000): Candle[] {
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

/** Market states chosen to span the engine's declared regimes. */
const CORPUS: Array<{ name: string; candles: Candle[] }> = [
  {
    name: 'steady uptrend with pullbacks',
    candles: candles(Array.from({ length: 260 }, (_, i) => 100 + i * 0.5 + Math.sin(i / 6) * 3)),
  },
  {
    name: 'steady downtrend',
    candles: candles(Array.from({ length: 260 }, (_, i) => 260 - i * 0.5 + Math.sin(i / 6) * 3)),
  },
  {
    name: 'trendless chop',
    candles: candles(Array.from({ length: 260 }, (_, i) => 100 + 3 * Math.sin(i / 2.1) + 2 * Math.sin(i / 1.3))),
  },
  {
    name: 'volatility compression',
    candles: candles(new Array(260).fill(100), 8),
  },
  {
    name: 'violent directionless swings',
    // volatile-expansion needs ATR above 4% of price with NO trend and no
    // squeeze — a market thrashing hard while going nowhere. The calmer chop
    // series above does not reach that ATR.
    candles: candles(
      Array.from({ length: 260 }, (_, i) => 100 * (1 + 0.09 * Math.sin(i / 1.7) + 0.05 * Math.sin(i / 2.9))),
      6,
    ),
  },
  {
    name: 'parabolic blow-off',
    candles: candles(Array.from({ length: 260 }, (_, i) => 100 * Math.exp(i / 90))),
  },
  {
    name: 'capitulation then base',
    // Sharp sell-off into a higher low: the shape that produces an oversold
    // oscillator alongside a bullish divergence.
    candles: candles([
      ...Array.from({ length: 120 }, (_, i) => 200 - i * 0.2),
      ...Array.from({ length: 40 }, (_, i) => 176 - i * 1.4),
      ...Array.from({ length: 30 }, (_, i) => 120 + i * 0.8),
      ...Array.from({ length: 40 }, (_, i) => 144 - i * 0.65),
      ...Array.from({ length: 30 }, (_, i) => 118 + i * 0.5),
    ]),
  },
  {
    name: 'euphoric top then lower high',
    candles: candles([
      ...Array.from({ length: 120 }, (_, i) => 100 + i * 0.2),
      ...Array.from({ length: 40 }, (_, i) => 124 + i * 1.4),
      ...Array.from({ length: 30 }, (_, i) => 180 - i * 0.8),
      ...Array.from({ length: 40 }, (_, i) => 156 + i * 0.65),
      ...Array.from({ length: 30 }, (_, i) => 182 - i * 0.5),
    ]),
  },
];

/**
 * Walk each corpus series bar by bar, collecting every outcome the engine
 * produces. Sliced windows only — the same discipline the backtest harness uses.
 */
function observed(): {
  strategies: Set<Strategy>;
  timings: Set<Timing>;
  regimes: Set<Regime>;
  overrides: Set<Direction>;
} {
  const strategies = new Set<Strategy>();
  const timings = new Set<Timing>();
  const regimes = new Set<Regime>();
  const overrides = new Set<Direction>();

  for (const entry of CORPUS) {
    for (let i = 80; i < entry.candles.length; i++) {
      const window = entry.candles.slice(Math.max(0, i - 259), i + 1);
      const read = analyzeTimeframe(window, 252, DEFAULT_THRESHOLDS);
      if (!read) continue;
      regimes.add(read.regime);
      const bias: Direction = read.trend.direction === 'down' ? 'short' : 'long';
      for (const side of [bias, bias === 'long' ? 'short' : 'long'] as Direction[]) {
        const r = chooseStrategy(side, read, read, DEFAULT_THRESHOLDS);
        strategies.add(r.strategy);
        timings.add(r.timing);
        if (r.directionOverride) overrides.add(r.directionOverride);
      }
    }
  }
  return { strategies, timings, regimes, overrides };
}

/**
 * `reversal` is deliberately excluded from the synthetic reachability sweep.
 *
 * It is genuinely reachable — the fixed engine produced 5 of them on crypto
 * swing and 1 on equity swing — but it requires three independent rare events
 * to coincide on the SAME bar: a non-trending regime, an RSI extreme, and a
 * matching regular divergence. Instrumented over 3,011 real BTCUSDT daily bars:
 * 710 passed the regime gate, 22 also had an RSI extreme, and exactly 1 also
 * had the divergence. That is ~0.03% of bars, and no synthetic corpus of this
 * size reproduces it honestly.
 *
 * Asserting it here would mean contorting a fixture until it passed, which
 * tests the fixture rather than the engine. Its reachability is instead pinned
 * by the measured record in calibration.ts, and by the direction test below
 * that exercises the branch conditions directly.
 */
const ALL_STRATEGIES: Strategy[] = ['trend-pullback', 'breakout', 'range-reversion', 'none'];
const ALL_TIMINGS: Timing[] = ['enter-now', 'wait-pullback', 'wait-breakout', 'stand-aside'];
const ALL_REGIMES: Regime[] = ['trending', 'ranging', 'volatile-expansion', 'compressed'];

describe('reachability', () => {
  const seen = observed();

  test('every declared strategy is producible', () => {
    for (const strategy of ALL_STRATEGIES) {
      // A failure here means the branch is unreachable, not that the corpus is
      // thin — check the branch conditions for mutual exclusion before adding
      // another series.
      expect({ strategy, reachable: seen.strategies.has(strategy) }).toEqual({ strategy, reachable: true });
    }
  });

  test('every declared timing is producible', () => {
    for (const timing of ALL_TIMINGS) {
      expect({ timing, reachable: seen.timings.has(timing) }).toEqual({ timing, reachable: true });
    }
  });

  test('every declared regime is producible', () => {
    for (const regime of ALL_REGIMES) {
      expect({ regime, reachable: seen.regimes.has(regime) }).toEqual({ regime, reachable: true });
    }
  });

  test('reversal fades the extreme rather than following the bias', () => {
    // The original defect, pinned directly on the branch conditions instead of
    // through a fixture: the setup demanded a long bias in an oversold market,
    // which the trend-derived bias can never supply. Direction must come from
    // the RSI extreme, and must contradict the bias it fades.
    const oversoldRead = {
      ...analyzeTimeframe(CORPUS[2].candles, 252, DEFAULT_THRESHOLDS)!,
      momentum: { ...analyzeTimeframe(CORPUS[2].candles, 252, DEFAULT_THRESHOLDS)!.momentum, rsiState: 'oversold' as const },
      divergences: [
        { type: 'bullish' as const, kind: 'regular' as const, priceFrom: 100, priceTo: 95, oscillatorFrom: 25, oscillatorTo: 30, barsAgo: 2 },
      ],
      trend: { ...analyzeTimeframe(CORPUS[2].candles, 252, DEFAULT_THRESHOLDS)!.trend, strength: 10, direction: 'down' as const },
      regime: 'ranging' as const,
      levels: { ...analyzeTimeframe(CORPUS[2].candles, 252, DEFAULT_THRESHOLDS)!.levels, rangePosition: 0.5 },
    };
    const r = chooseStrategy('short', oversoldRead, oversoldRead, DEFAULT_THRESHOLDS);
    expect(r.strategy).toBe('reversal');
    expect(r.timing).toBe('wait-confirmation');
    // Bias was 'short'; an oversold market must be faded LONG.
    expect(r.directionOverride).toBe('long');
  });

  test('the mirror case fades an overbought market short', () => {
    const base = analyzeTimeframe(CORPUS[2].candles, 252, DEFAULT_THRESHOLDS)!;
    const overboughtRead = {
      ...base,
      momentum: { ...base.momentum, rsiState: 'overbought' as const },
      divergences: [
        { type: 'bearish' as const, kind: 'regular' as const, priceFrom: 95, priceTo: 100, oscillatorFrom: 80, oscillatorTo: 72, barsAgo: 2 },
      ],
      trend: { ...base.trend, strength: 10, direction: 'up' as const },
      regime: 'ranging' as const,
      levels: { ...base.levels, rangePosition: 0.5 },
    };
    const r = chooseStrategy('long', overboughtRead, overboughtRead, DEFAULT_THRESHOLDS);
    expect(r.strategy).toBe('reversal');
    expect(r.directionOverride).toBe('short');
  });

  test('the corpus is diverse enough for the guard to mean something', () => {
    // Guards against the whole file passing because one degenerate series
    // happens to produce everything.
    expect(seen.regimes.size).toBeGreaterThanOrEqual(3);
    expect(seen.strategies.size).toBeGreaterThanOrEqual(4);
  });
});
