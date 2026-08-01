import { describe, test, expect } from 'bun:test';
import {
  sma,
  ema,
  wilderSmooth,
  rsi,
  macd,
  roc,
  stochastic,
  stochRsi,
  trueRange,
  atr,
  atrPercent,
  bollinger,
  keltner,
  squeeze,
  realizedVolatility,
  maxDrawdown,
  adx,
  regressionSlope,
  obv,
  vwap,
  mfi,
  relativeVolume,
  swingPoints,
  supportResistance,
  donchian,
  pivotPoints,
  fibonacci,
  detectDivergence,
  correlation,
  beta,
  last,
  at,
  type Candle,
} from './indicators.js';

/**
 * Wilder's own worked example from "New Concepts in Technical Trading Systems",
 * the dataset every charting package validates RSI against. If our smoothing
 * were a standard EMA instead of Wilder's, the first value would come out near
 * 72 rather than 70.53 — close enough to pass a smell test, which is exactly
 * why this needs a reference value rather than a hand-checked one.
 */
const WILDER_CLOSES = [
  44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0,
  46.03, 46.41, 46.22, 45.64, 46.21, 46.25, 45.71, 46.45, 45.78, 45.35, 44.03, 44.18, 44.22, 44.57, 43.42, 42.66,
  43.13,
];

/** Build synthetic candles from a close series with a fixed intrabar range. */
function candlesFrom(closes: number[], spread = 1, volume = 1000): Candle[] {
  return closes.map((c, i) => ({
    date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
    open: c,
    high: c + spread / 2,
    low: c - spread / 2,
    close: c,
    volume,
  }));
}

describe('moving averages', () => {
  test('sma is null until the lookback fills, then correct', () => {
    const r = sma([1, 2, 3, 4, 5], 3);
    expect(r).toEqual([null, null, 2, 3, 4]);
  });

  test('sma of a constant series is that constant', () => {
    expect(last(sma(new Array(50).fill(7), 20))).toBe(7);
  });

  test('ema seeds with the simple average of the first period', () => {
    const r = ema([1, 2, 3, 4, 5], 3);
    // Seed = mean(1,2,3) = 2, then k = 2/4 = 0.5.
    expect(r[2]).toBe(2);
    expect(r[3]).toBe(3); // 4*0.5 + 2*0.5
    expect(r[4]).toBe(4); // 5*0.5 + 3*0.5
  });

  test('ema reacts faster than sma in the bars right after a step change', () => {
    // Measured 3 bars in, not 10: by the 10th bar the SMA window holds only
    // post-step values and has absorbed the move completely, so comparing
    // there would test the opposite of the intended property.
    const values = [...new Array(30).fill(10), 20, 20, 20];
    const e = last(ema(values, 10)) as number;
    const s = last(sma(values, 10)) as number;
    expect(e).toBeGreaterThan(s);
  });

  test('wilderSmooth decays more slowly than an equivalent ema', () => {
    const values = [...new Array(30).fill(10), ...new Array(10).fill(20)];
    const w = last(wilderSmooth(values, 10)) as number;
    const e = last(ema(values, 10)) as number;
    expect(w).toBeLessThan(e);
  });

  test('returns an all-null series when there is not enough data', () => {
    expect(sma([1, 2], 5).every((v) => v === null)).toBe(true);
    expect(ema([1, 2], 5).every((v) => v === null)).toBe(true);
  });
});

describe('rsi', () => {
  test('matches the seed value derived by hand from the definition', () => {
    // First 14 changes: gains sum to 3.34, losses to 1.40.
    //   avgGain = 3.34/14 = 0.2385714, avgLoss = 1.40/14 = 0.10
    //   RS = 2.3857143  ->  RSI = 100 - 100/3.3857143 = 70.4641
    // Worth deriving rather than copying: the "70.53" that circulates in
    // reproduced tables belongs to a slightly different close list, and
    // matching it would have meant breaking a correct implementation.
    const r = rsi(WILDER_CLOSES, 14);
    expect(r[14]).toBeCloseTo(70.4641, 3);
  });

  test('applies Wilder smoothing rather than a standard EMA on later bars', () => {
    // Bar 15 change is -0.28, so:
    //   avgGain = (0.2385714*13 + 0)/14 = 0.2215306
    //   avgLoss = (0.10*13 + 0.28)/14   = 0.1128571
    //   RS = 1.962927 -> RSI = 66.2496
    // A 2/(n+1) EMA here would land near 65.7, so this pins the smoothing.
    const r = rsi(WILDER_CLOSES, 14);
    expect(r[15]).toBeCloseTo(66.2496, 3);
    expect(r[19]).toBeCloseTo(57.915, 2);
  });

  test('is undefined before the period is satisfied', () => {
    const r = rsi(WILDER_CLOSES, 14);
    expect(r.slice(0, 14).every((v) => v === null)).toBe(true);
  });

  test('a series that only rises pins RSI at 100 rather than dividing by zero', () => {
    const r = rsi(Array.from({ length: 40 }, (_, i) => 100 + i), 14);
    expect(last(r)).toBe(100);
  });

  test('a series that only falls pins RSI at 0', () => {
    const r = rsi(Array.from({ length: 40 }, (_, i) => 100 - i), 14);
    expect(last(r)).toBe(0);
  });
});

describe('macd', () => {
  test('the histogram is exactly macd minus signal', () => {
    const closes = Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i / 5) * 10);
    const { macd: line, signal, histogram } = macd(closes);
    const i = closes.length - 1;
    expect(histogram[i]).toBeCloseTo((line[i] as number) - (signal[i] as number), 10);
  });

  test('macd is positive when a fast uptrend outruns the slow average', () => {
    const closes = Array.from({ length: 120 }, (_, i) => 100 + i);
    expect(last(macd(closes).macd) as number).toBeGreaterThan(0);
  });

  test('all three series stay aligned to the input length', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
    const r = macd(closes);
    expect(r.macd).toHaveLength(60);
    expect(r.signal).toHaveLength(60);
    expect(r.histogram).toHaveLength(60);
  });
});

describe('roc and momentum', () => {
  test('roc reports the percentage change over the lookback', () => {
    expect(last(roc([100, 110, 120, 130], 3))).toBeCloseTo(30, 6);
  });
});

describe('stochastic family', () => {
  test('%K pins near 100 when the close sits at the top of the range', () => {
    const candles = candlesFrom(Array.from({ length: 40 }, (_, i) => 100 + i), 0);
    expect(last(stochastic(candles).k) as number).toBeGreaterThan(95);
  });

  test('a flat range yields the neutral 50 rather than a divide-by-zero', () => {
    const candles = candlesFrom(new Array(40).fill(100), 0);
    expect(last(stochastic(candles).k)).toBe(50);
  });

  test('stochRsi stays within 0-100', () => {
    const closes = Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i / 7) * 12);
    const v = last(stochRsi(closes).k) as number;
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(100);
  });
});

describe('volatility', () => {
  test('true range accounts for gaps, not just the intrabar range', () => {
    const candles: Candle[] = [
      { date: 'd1', open: 10, high: 11, low: 9, close: 10, volume: 1 },
      // Gaps up to 20-22: the true range is 22-10 = 12, not the 2-point bar range.
      { date: 'd2', open: 20, high: 22, low: 20, close: 21, volume: 1 },
    ];
    expect(trueRange(candles)[1]).toBe(12);
  });

  test('atr of a constant-range series equals that range', () => {
    const candles = candlesFrom(new Array(40).fill(100), 2);
    expect(last(atr(candles, 14))).toBeCloseTo(2, 6);
  });

  test('atrPercent normalises across price levels', () => {
    const cheap = candlesFrom(new Array(40).fill(10), 0.2);
    const rich = candlesFrom(new Array(40).fill(1000), 20);
    expect(last(atrPercent(cheap, 14))).toBeCloseTo(last(atrPercent(rich, 14)) as number, 6);
  });

  test('bollinger bands collapse onto the mean when price is flat', () => {
    const b = bollinger(new Array(40).fill(100), 20, 2);
    expect(last(b.upper)).toBeCloseTo(100, 6);
    expect(last(b.lower)).toBeCloseTo(100, 6);
    expect(last(b.bandwidth)).toBeCloseTo(0, 6);
  });

  test('percentB reports where price sits inside the band', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 4) * 5);
    const b = bollinger(closes, 20, 2);
    const v = last(b.percentB) as number;
    expect(v).toBeGreaterThan(-1);
    expect(v).toBeLessThan(2);
  });

  test('keltner channels widen with atr', () => {
    const calm = candlesFrom(new Array(60).fill(100), 1);
    const wild = candlesFrom(new Array(60).fill(100), 10);
    const calmWidth = (last(keltner(calm).upper) as number) - (last(keltner(calm).lower) as number);
    const wildWidth = (last(keltner(wild).upper) as number) - (last(keltner(wild).lower) as number);
    expect(wildWidth).toBeGreaterThan(calmWidth);
  });

  test('squeeze fires when bollinger contracts inside keltner', () => {
    // Flat closes with a wide intrabar range: deviation collapses while ATR
    // stays large, which is precisely the squeeze condition.
    const candles = candlesFrom(new Array(60).fill(100), 8);
    expect(squeeze(candles).at(-1)).toBe(true);
  });

  test('squeeze is false when price swings widely', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 2) * 25);
    expect(squeeze(candlesFrom(closes, 0.5)).at(-1)).toBe(false);
  });

  test('realized volatility is zero for a flat series and positive otherwise', () => {
    expect(realizedVolatility(new Array(40).fill(100), 20)).toBeCloseTo(0, 6);
    const noisy = Array.from({ length: 40 }, (_, i) => 100 + (i % 2 === 0 ? 5 : -5));
    expect(realizedVolatility(noisy, 20) as number).toBeGreaterThan(0);
  });

  test('maxDrawdown measures the worst peak-to-trough decline', () => {
    expect(maxDrawdown([100, 120, 60, 90])).toBeCloseTo(50, 6);
    expect(maxDrawdown([100, 101, 102])).toBeCloseTo(0, 6);
  });
});

describe('adx', () => {
  test('a strong one-way trend produces a high adx with +DI dominant', () => {
    const candles = candlesFrom(Array.from({ length: 80 }, (_, i) => 100 + i * 2), 1);
    const r = adx(candles, 14);
    expect(last(r.adx) as number).toBeGreaterThan(40);
    expect(last(r.plusDI) as number).toBeGreaterThan(last(r.minusDI) as number);
  });

  test('a downtrend flips directional dominance', () => {
    const candles = candlesFrom(Array.from({ length: 80 }, (_, i) => 300 - i * 2), 1);
    const r = adx(candles, 14);
    expect(last(r.minusDI) as number).toBeGreaterThan(last(r.plusDI) as number);
  });

  test('a choppy range keeps adx low — the "do not trend-follow here" signal', () => {
    const closes = Array.from({ length: 120 }, (_, i) => 100 + (i % 2 === 0 ? 1 : -1));
    expect(last(adx(candlesFrom(closes, 0.5), 14).adx) as number).toBeLessThan(25);
  });
});

describe('regressionSlope', () => {
  test('is positive for a rising series and negative for a falling one', () => {
    expect(regressionSlope(Array.from({ length: 30 }, (_, i) => 100 + i), 20) as number).toBeGreaterThan(0);
    expect(regressionSlope(Array.from({ length: 30 }, (_, i) => 100 - i), 20) as number).toBeLessThan(0);
  });

  test('is zero for a flat series', () => {
    expect(regressionSlope(new Array(30).fill(100), 20)).toBeCloseTo(0, 10);
  });
});

describe('volume indicators', () => {
  test('obv accumulates on up-closes and sheds on down-closes', () => {
    const candles: Candle[] = [
      { date: 'd1', open: 10, high: 10, low: 10, close: 10, volume: 100 },
      { date: 'd2', open: 11, high: 11, low: 11, close: 11, volume: 50 },
      { date: 'd3', open: 9, high: 9, low: 9, close: 9, volume: 30 },
      { date: 'd4', open: 9, high: 9, low: 9, close: 9, volume: 40 },
    ];
    expect(obv(candles)).toEqual([0, 50, 20, 20]);
  });

  test('vwap of constant-price bars is that price', () => {
    expect(last(vwap(candlesFrom(new Array(20).fill(50), 0)))).toBeCloseTo(50, 6);
  });

  test('vwap is null when no volume traded rather than dividing by zero', () => {
    expect(last(vwap(candlesFrom(new Array(5).fill(50), 0, 0)))).toBeNull();
  });

  test('mfi stays within 0-100', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 5) * 8);
    const v = last(mfi(candlesFrom(closes), 14)) as number;
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(100);
  });

  test('relativeVolume compares the last bar to its own average', () => {
    const candles = candlesFrom(new Array(30).fill(100));
    candles[candles.length - 1].volume = 3000; // 3x the 1000 baseline
    expect(relativeVolume(candles, 20)).toBeCloseTo(3, 6);
  });
});

describe('market structure', () => {
  test('swingPoints finds the peak of a triangle', () => {
    const closes = [1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1];
    const points = swingPoints(candlesFrom(closes, 0), 3);
    const highs = points.filter((p) => p.type === 'high');
    expect(highs).toHaveLength(1);
    expect(highs[0].price).toBe(7);
  });

  test('a monotonic series has no interior swing points', () => {
    const points = swingPoints(candlesFrom(Array.from({ length: 30 }, (_, i) => i), 0), 3);
    expect(points.filter((p) => p.type === 'high')).toHaveLength(0);
  });

  test('supportResistance splits levels around the current price', () => {
    const closes = [10, 12, 14, 12, 10, 12, 14, 12, 10, 12, 14, 12, 10, 12, 14, 12, 10, 12];
    const { support, resistance } = supportResistance(candlesFrom(closes, 0.2), 12);
    expect(support.every((l) => l.price < 12)).toBe(true);
    expect(resistance.every((l) => l.price >= 12)).toBe(true);
  });

  test('level strength does not depend on how much history was passed in', () => {
    // The defect this pins: recency was normalised by window length, so the
    // SAME level scored differently depending only on the caller's window —
    // 0.58 for a touch 50 bars ago in a 120-bar window, 0.87 in a 400-bar one.
    // That reordered the levels and moved the stop derived from them.
    // Isolate the one variable that matters. A flat plateau produces no swing
    // points at all (strict-inequality rule), so prepending one changes the
    // series LENGTH without changing a single cluster. Any strength difference
    // is then attributable to window normalisation and nothing else.
    const active = Array.from({ length: 150 }, (_, i) => 100 + Math.sin(i / 9) * 12);
    const short = candlesFrom(active, 0.6);
    const long = candlesFrom([...new Array(250).fill(active[0]), ...active], 0.6);
    const price = active[active.length - 1];

    const keyed = (candles: Candle[]): Map<string, number> => {
      const { support, resistance } = supportResistance(candles, price, { maxLevels: 12 });
      return new Map([...support, ...resistance].map((l) => [l.price.toFixed(3), l.strength]));
    };

    const a = keyed(short);
    const b = keyed(long);
    let compared = 0;
    for (const [levelPrice, strength] of a) {
      const other = b.get(levelPrice);
      if (other === undefined) continue;
      expect(other).toBeCloseTo(strength, 6);
      compared++;
    }
    // Guard against the assertion passing vacuously on zero overlap — an
    // earlier version of this test did exactly that.
    expect(compared).toBeGreaterThan(0);
  });

  test('a recent level outranks an equally-touched older one', () => {
    const closes = Array.from({ length: 200 }, (_, i) => 100 + Math.sin(i / 7) * 8);
    const { support } = supportResistance(candlesFrom(closes, 0.5), closes[closes.length - 1], { maxLevels: 12 });
    if (support.length >= 2) {
      const sameTouches = support.filter((l) => l.touches === support[0].touches);
      if (sameTouches.length >= 2) {
        const [newer, older] = [...sameTouches].sort((a, b) => b.lastIndex - a.lastIndex);
        expect(newer.strength).toBeGreaterThanOrEqual(older.strength);
      }
    }
  });

  test('an old level keeps a floor of its weight rather than decaying to nothing', () => {
    // Price remembers where it was rejected repeatedly, even long ago; a level
    // that decays to zero would let a heavily-tested shelf vanish entirely.
    const closes = Array.from({ length: 400 }, (_, i) => (i < 60 ? 100 + Math.sin(i / 5) * 15 : 160 + i * 0.05));
    const { support } = supportResistance(candlesFrom(closes, 0.5), closes[closes.length - 1], { maxLevels: 12 });
    for (const l of support) expect(l.strength).toBeGreaterThanOrEqual(l.touches * 0.25 - 1e-9);
  });

  test('a level tested repeatedly outranks one touched once', () => {
    // 10 is revisited on every cycle; 4 is a single excursion.
    const closes = [10, 20, 10, 20, 10, 20, 10, 20, 4, 20, 10, 20, 10, 20, 10, 20, 10, 20, 10, 20];
    const { support } = supportResistance(candlesFrom(closes, 0.2), 25, { maxLevels: 10 });
    const repeated = support.find((l) => Math.abs(l.price - 10) < 1);
    const once = support.find((l) => Math.abs(l.price - 4) < 1);
    expect(repeated).toBeDefined();
    if (repeated && once) expect(repeated.strength).toBeGreaterThan(once.strength);
  });

  test('donchian tracks the extremes of the window', () => {
    const closes = [1, 5, 3, 9, 2, 7, 4];
    const d = donchian(candlesFrom(closes, 0), 3);
    expect(last(d.upper)).toBe(7);
    expect(d.upper[3]).toBe(9);
  });

  test('pivotPoints orders the levels correctly around the pivot', () => {
    const p = pivotPoints({ date: 'd', open: 100, high: 110, low: 90, close: 105, volume: 1 });
    expect(p.pivot).toBeCloseTo(101.6667, 3);
    expect(p.s3).toBeLessThan(p.s2);
    expect(p.s2).toBeLessThan(p.s1);
    expect(p.s1).toBeLessThan(p.pivot);
    expect(p.pivot).toBeLessThan(p.r1);
    expect(p.r1).toBeLessThan(p.r2);
    expect(p.r2).toBeLessThan(p.r3);
  });

  test('fibonacci places the golden ratio at the right depth', () => {
    const f = fibonacci(100, 200);
    expect(f['0']).toBe(200);
    expect(f['100']).toBe(100);
    expect(f['50']).toBe(150);
    expect(f['61.8']).toBeCloseTo(138.2, 4);
    expect(f['161.8']).toBeCloseTo(261.8, 4);
  });
});

describe('divergence', () => {
  // Zig-zag with no flat tail: a plateau would otherwise register as a pivot
  // and displace the peak we mean to compare against.
  const TWO_PEAKS = [10, 12, 14, 12, 10, 12, 16, 12, 10, 11, 9, 11, 9];
  const TWO_TROUGHS = [20, 18, 14, 18, 20, 18, 12, 18, 20, 19, 21, 19, 21];

  test('spots a regular bearish divergence: higher price high, lower oscillator high', () => {
    const osc: Array<number | null> = TWO_PEAKS.map(() => 50);
    // The second, higher price peak carries the weaker oscillator reading.
    osc[2] = 80;
    osc[6] = 60;
    const found = detectDivergence(candlesFrom(TWO_PEAKS, 0), osc, { lookback: 2 });
    expect(found.some((d) => d.type === 'bearish' && d.kind === 'regular')).toBe(true);
  });

  test('spots a regular bullish divergence: lower price low, higher oscillator low', () => {
    const osc: Array<number | null> = TWO_TROUGHS.map(() => 50);
    osc[2] = 20;
    osc[6] = 35;
    const found = detectDivergence(candlesFrom(TWO_TROUGHS, 0), osc, { lookback: 2 });
    expect(found.some((d) => d.type === 'bullish' && d.kind === 'regular')).toBe(true);
  });

  test('reports nothing when price and oscillator agree', () => {
    const osc: Array<number | null> = TWO_PEAKS.map(() => 50);
    osc[2] = 60;
    osc[6] = 80; // higher high in both — momentum confirms the move
    const found = detectDivergence(candlesFrom(TWO_PEAKS, 0), osc, { lookback: 2 });
    expect(found.some((d) => d.type === 'bearish')).toBe(false);
  });

  test('a flat plateau produces no pivot at all', () => {
    // Regression guard: before the strict-inequality rule, every bar of a
    // plateau came back as both a swing high and a swing low.
    const flat = candlesFrom([5, 5, 5, 5, 5, 5, 5, 5, 5], 0);
    expect(swingPoints(flat, 2)).toHaveLength(0);
  });
});

describe('cross-asset', () => {
  test('identical series correlate at 1', () => {
    const a = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i / 3) * 10);
    expect(correlation(a, a)).toBeCloseTo(1, 6);
  });

  test('mirrored series correlate at -1', () => {
    const a = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i / 3) * 10);
    const b = a.map((v) => 200 - v);
    expect(correlation(a, b) as number).toBeLessThan(-0.9);
  });

  test('beta of a series against itself is 1', () => {
    const a = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i / 3) * 10);
    expect(beta(a, a)).toBeCloseTo(1, 6);
  });

  test('a 2x-amplitude asset has beta near 2', () => {
    const bench = Array.from({ length: 60 }, (_, i) => 100 * (1 + Math.sin(i / 5) * 0.01));
    const asset = bench.map((_, i) => 100 * (1 + Math.sin(i / 5) * 0.02));
    expect(beta(asset, bench) as number).toBeCloseTo(2, 1);
  });

  test('too few points yields null rather than a fabricated number', () => {
    expect(correlation([1, 2], [1, 2])).toBeNull();
    expect(beta([1, 2], [1, 2])).toBeNull();
  });
});

describe('series helpers', () => {
  test('last skips trailing nulls', () => {
    expect(last([1, 2, null])).toBe(2);
    expect(last([null, null])).toBeNull();
  });

  test('at indexes from the end', () => {
    expect(at([1, 2, 3], 0)).toBe(3);
    expect(at([1, 2, 3], 2)).toBe(1);
    expect(at([1, 2, 3], 9)).toBeNull();
  });
});
