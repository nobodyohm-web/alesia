/**
 * Technical indicator engine — pure, dependency-free, deterministic.
 *
 * Every function takes plain arrays and returns series aligned to the input
 * length, front-padded with `null` where the lookback is not yet satisfied.
 * That alignment is what makes crossovers, divergences and "state N bars ago"
 * expressible without index arithmetic at every call site.
 *
 * Nothing here fetches. Nothing here formats. Keeping the maths separate from
 * the I/O is what makes it testable against known reference values, which is
 * the only way to trust a stop-loss computed from it.
 *
 * Wilder's indicators (RSI, ATR, ADX) use Wilder smoothing — an EMA with
 * alpha = 1/period, seeded with a simple average. Using a standard EMA
 * (alpha = 2/(period+1)) is the single most common way these come out wrong,
 * and the error is subtle enough to survive eyeballing.
 */

export interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Series = Array<number | null>;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Round to a sane number of decimals without dragging float noise around. */
export function round(value: number, decimals = 4): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** Last non-null value of a series, or null if it never resolved. */
export function last(series: Series): number | null {
  for (let i = series.length - 1; i >= 0; i--) {
    if (isNum(series[i])) return series[i] as number;
  }
  return null;
}

/** Value `n` bars back from the end (n=0 is the last bar). */
export function at(series: Series, n: number): number | null {
  const v = series[series.length - 1 - n];
  return isNum(v) ? v : null;
}

// ============================================================================
// Moving averages
// ============================================================================

export function sma(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  const k = 2 / (period + 1);
  // Seed with the simple average of the first `period` values, the convention
  // charting packages use. Seeding with values[0] instead makes early bars
  // disagree with every chart the user will compare against.
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder's smoothing: alpha = 1/period. Used by RSI, ATR and ADX. */
export function wilderSmooth(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = (prev * (period - 1) + values[i]) / period;
    out[i] = prev;
  }
  return out;
}

// ============================================================================
// Momentum
// ============================================================================

/** Wilder's RSI. 0-100; >70 conventionally overbought, <30 oversold. */
export function rsi(closes: number[], period = 14): Series {
  const out: Series = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;

  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    gains.push(Math.max(change, 0));
    losses.push(Math.max(-change, 0));
  }

  const avgGain = wilderSmooth(gains, period);
  const avgLoss = wilderSmooth(losses, period);

  for (let i = 0; i < gains.length; i++) {
    const g = avgGain[i];
    const l = avgLoss[i];
    if (!isNum(g) || !isNum(l)) continue;
    // A period with no down-closes has zero average loss; RSI is 100 by
    // definition there rather than a division by zero.
    out[i + 1] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

export interface MacdResult {
  macd: Series;
  signal: Series;
  histogram: Series;
}

export function macd(closes: number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdLine: Series = closes.map((_, i) =>
    isNum(emaFast[i]) && isNum(emaSlow[i]) ? (emaFast[i] as number) - (emaSlow[i] as number) : null,
  );

  // The signal line is an EMA of the MACD line, which only exists from the
  // slow period onward — compute it on the defined slice, then re-align.
  const firstDefined = macdLine.findIndex(isNum);
  const signal: Series = new Array(closes.length).fill(null);
  if (firstDefined !== -1) {
    const dense = macdLine.slice(firstDefined).filter(isNum) as number[];
    const sig = ema(dense, signalPeriod);
    sig.forEach((v, i) => {
      signal[firstDefined + i] = v;
    });
  }

  const histogram: Series = closes.map((_, i) =>
    isNum(macdLine[i]) && isNum(signal[i]) ? (macdLine[i] as number) - (signal[i] as number) : null,
  );

  return { macd: macdLine, signal, histogram };
}

/** Rate of change over `period` bars, in percent. */
export function roc(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  for (let i = period; i < values.length; i++) {
    const base = values[i - period];
    if (base !== 0) out[i] = ((values[i] - base) / base) * 100;
  }
  return out;
}

export interface StochasticResult {
  k: Series;
  d: Series;
}

/** Stochastic oscillator (%K smoothed, %D). Range 0-100. */
export function stochastic(candles: Candle[], period = 14, smoothK = 3, smoothD = 3): StochasticResult {
  const raw: Series = new Array(candles.length).fill(null);
  for (let i = period - 1; i < candles.length; i++) {
    const window = candles.slice(i - period + 1, i + 1);
    const hh = Math.max(...window.map((c) => c.high));
    const ll = Math.min(...window.map((c) => c.low));
    // A flat range means no position information; 50 is the neutral reading.
    raw[i] = hh === ll ? 50 : ((candles[i].close - ll) / (hh - ll)) * 100;
  }
  const k = smoothSeries(raw, smoothK);
  const d = smoothSeries(k, smoothD);
  return { k, d };
}

/** Simple moving average over a sparse series, preserving alignment. */
function smoothSeries(series: Series, period: number): Series {
  const out: Series = new Array(series.length).fill(null);
  if (period <= 1) return series.slice();
  for (let i = 0; i < series.length; i++) {
    if (i < period - 1) continue;
    const window = series.slice(i - period + 1, i + 1);
    if (window.every(isNum)) {
      out[i] = (window as number[]).reduce((a, b) => a + b, 0) / period;
    }
  }
  return out;
}

/**
 * Stochastic RSI — the stochastic oscillator applied to RSI rather than price.
 * Reaches its extremes far more often than RSI, which makes it useful for
 * timing entries inside an established trend where RSI never hits 30.
 */
export function stochRsi(closes: number[], rsiPeriod = 14, stochPeriod = 14, smoothK = 3, smoothD = 3): StochasticResult {
  const r = rsi(closes, rsiPeriod);
  const raw: Series = new Array(closes.length).fill(null);
  for (let i = 0; i < r.length; i++) {
    const window = r.slice(Math.max(0, i - stochPeriod + 1), i + 1);
    if (window.length < stochPeriod || !window.every(isNum)) continue;
    const vals = window as number[];
    const hh = Math.max(...vals);
    const ll = Math.min(...vals);
    raw[i] = hh === ll ? 50 : ((vals[vals.length - 1] - ll) / (hh - ll)) * 100;
  }
  const k = smoothSeries(raw, smoothK);
  const d = smoothSeries(k, smoothD);
  return { k, d };
}

// ============================================================================
// Volatility
// ============================================================================

/** True range per bar: the widest of today's range and the gaps from yesterday. */
export function trueRange(candles: Candle[]): number[] {
  return candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prevClose = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  });
}

/** Wilder's Average True Range — the unit every stop-loss here is measured in. */
export function atr(candles: Candle[], period = 14): Series {
  return wilderSmooth(trueRange(candles), period);
}

/** ATR as a percentage of price: comparable across a $3 and a $900 instrument. */
export function atrPercent(candles: Candle[], period = 14): Series {
  const a = atr(candles, period);
  return a.map((v, i) => (isNum(v) && candles[i].close !== 0 ? (v / candles[i].close) * 100 : null));
}

export interface BollingerResult {
  upper: Series;
  middle: Series;
  lower: Series;
  /** (upper - lower) / middle, in percent. Low bandwidth precedes expansion. */
  bandwidth: Series;
  /** Where price sits in the band: 0 = lower, 1 = upper. */
  percentB: Series;
}

export function bollinger(closes: number[], period = 20, stdDevs = 2): BollingerResult {
  const middle = sma(closes, period);
  const upper: Series = new Array(closes.length).fill(null);
  const lower: Series = new Array(closes.length).fill(null);
  const bandwidth: Series = new Array(closes.length).fill(null);
  const percentB: Series = new Array(closes.length).fill(null);

  for (let i = period - 1; i < closes.length; i++) {
    const mean = middle[i];
    if (!isNum(mean)) continue;
    const window = closes.slice(i - period + 1, i + 1);
    // Population standard deviation, matching the charting convention.
    const variance = window.reduce((acc, v) => acc + (v - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    const u = mean + stdDevs * sd;
    const l = mean - stdDevs * sd;
    upper[i] = u;
    lower[i] = l;
    bandwidth[i] = mean !== 0 ? ((u - l) / mean) * 100 : null;
    percentB[i] = u !== l ? (closes[i] - l) / (u - l) : 0.5;
  }
  return { upper, middle, lower, bandwidth, percentB };
}

export interface KeltnerResult {
  upper: Series;
  middle: Series;
  lower: Series;
}

/** Keltner channels: an EMA envelope scaled by ATR rather than deviation. */
export function keltner(candles: Candle[], period = 20, mult = 1.5, atrPeriod = 10): KeltnerResult {
  const closes = candles.map((c) => c.close);
  const middle = ema(closes, period);
  const a = atr(candles, atrPeriod);
  const upper: Series = closes.map((_, i) =>
    isNum(middle[i]) && isNum(a[i]) ? (middle[i] as number) + mult * (a[i] as number) : null,
  );
  const lower: Series = closes.map((_, i) =>
    isNum(middle[i]) && isNum(a[i]) ? (middle[i] as number) - mult * (a[i] as number) : null,
  );
  return { upper, middle, lower };
}

/**
 * TTM-style squeeze: Bollinger Bands contained inside the Keltner channels
 * means volatility has compressed. Squeezes resolve into directional moves,
 * so a squeeze that is releasing is one of the few genuinely useful timing
 * signals — it says "soon", and the trend filter says "which way".
 */
export function squeeze(candles: Candle[], bbPeriod = 20, bbStd = 2, kcMult = 1.5): Array<boolean | null> {
  const closes = candles.map((c) => c.close);
  const bb = bollinger(closes, bbPeriod, bbStd);
  const kc = keltner(candles, bbPeriod, kcMult);
  return closes.map((_, i) => {
    if (!isNum(bb.upper[i]) || !isNum(kc.upper[i]) || !isNum(bb.lower[i]) || !isNum(kc.lower[i])) return null;
    return (bb.upper[i] as number) < (kc.upper[i] as number) && (bb.lower[i] as number) > (kc.lower[i] as number);
  });
}

/** Annualised realised volatility from log returns, in percent. */
export function realizedVolatility(closes: number[], period = 20, periodsPerYear = 252): number | null {
  if (closes.length < period + 1) return null;
  const returns: number[] = [];
  for (let i = closes.length - period; i < closes.length; i++) {
    if (closes[i - 1] > 0 && closes[i] > 0) returns.push(Math.log(closes[i] / closes[i - 1]));
  }
  if (returns.length < 2) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  // Sample variance (n-1): these returns are a sample of the process, not the
  // population, and with period=20 the difference is not cosmetic.
  const variance = returns.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(periodsPerYear) * 100;
}

/** Largest peak-to-trough decline over the window, in percent (positive number). */
export function maxDrawdown(closes: number[]): number | null {
  if (closes.length < 2) return null;
  let peak = closes[0];
  let worst = 0;
  for (const c of closes) {
    if (c > peak) peak = c;
    if (peak > 0) worst = Math.max(worst, ((peak - c) / peak) * 100);
  }
  return worst;
}

// ============================================================================
// Trend
// ============================================================================

export interface AdxResult {
  adx: Series;
  plusDI: Series;
  minusDI: Series;
}

/**
 * Wilder's ADX with directional indicators. ADX measures trend STRENGTH only —
 * it says nothing about direction, which is what +DI/-DI are for. Below 20 the
 * market is ranging, and trend-following entries there are how accounts bleed.
 */
export function adx(candles: Candle[], period = 14): AdxResult {
  const n = candles.length;
  const empty: Series = new Array(n).fill(null);
  if (n < period * 2) return { adx: empty, plusDI: empty.slice(), minusDI: empty.slice() };

  const plusDM: number[] = [];
  const minusDM: number[] = [];
  for (let i = 1; i < n; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    // Only the larger of the two directional moves counts, and only if positive.
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  const tr = trueRange(candles).slice(1);
  const smoothTR = wilderSmooth(tr, period);
  const smoothPlus = wilderSmooth(plusDM, period);
  const smoothMinus = wilderSmooth(minusDM, period);

  const plusDI: Series = new Array(n).fill(null);
  const minusDI: Series = new Array(n).fill(null);
  const dx: number[] = [];
  let firstDxIndex = -1;

  for (let i = 0; i < tr.length; i++) {
    const t = smoothTR[i];
    const p = smoothPlus[i];
    const m = smoothMinus[i];
    if (!isNum(t) || !isNum(p) || !isNum(m) || t === 0) continue;
    const pdi = (p / t) * 100;
    const mdi = (m / t) * 100;
    plusDI[i + 1] = pdi;
    minusDI[i + 1] = mdi;
    const sum = pdi + mdi;
    if (firstDxIndex === -1) firstDxIndex = i + 1;
    dx.push(sum === 0 ? 0 : (Math.abs(pdi - mdi) / sum) * 100);
  }

  const adxSeries: Series = new Array(n).fill(null);
  const smoothedDx = wilderSmooth(dx, period);
  smoothedDx.forEach((v, i) => {
    if (firstDxIndex !== -1) adxSeries[firstDxIndex + i] = v;
  });

  return { adx: adxSeries, plusDI, minusDI };
}

/**
 * Slope of a least-squares fit over the last `period` closes, expressed as
 * percent-per-bar. Direction-of-trend without the lag of a moving average
 * crossover, and comparable across instruments because it is normalised.
 */
export function regressionSlope(values: number[], period = 20): number | null {
  if (values.length < period) return null;
  const window = values.slice(-period);
  const n = window.length;
  const meanX = (n - 1) / 2;
  const meanY = window.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (window[i] - meanY);
    den += (i - meanX) ** 2;
  }
  if (den === 0 || meanY === 0) return null;
  return ((num / den) / meanY) * 100;
}

// ============================================================================
// Volume
// ============================================================================

/** On-balance volume: cumulative volume signed by the close-to-close direction. */
export function obv(candles: Candle[]): Series {
  const out: Series = new Array(candles.length).fill(null);
  if (candles.length === 0) return out;
  let total = 0;
  out[0] = 0;
  for (let i = 1; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    total += diff > 0 ? candles[i].volume : diff < 0 ? -candles[i].volume : 0;
    out[i] = total;
  }
  return out;
}

/**
 * Volume-weighted average price over a rolling window. The institutional
 * reference price — for a day trade, being above or below it is the difference
 * between buying with the flow and against it.
 */
export function vwap(candles: Candle[], period?: number): Series {
  const out: Series = new Array(candles.length).fill(null);
  for (let i = 0; i < candles.length; i++) {
    const start = period ? Math.max(0, i - period + 1) : 0;
    let pv = 0;
    let vol = 0;
    for (let j = start; j <= i; j++) {
      const typical = (candles[j].high + candles[j].low + candles[j].close) / 3;
      pv += typical * candles[j].volume;
      vol += candles[j].volume;
    }
    // Zero traded volume (a halted or synthetic bar) leaves VWAP undefined
    // rather than dividing by zero.
    out[i] = vol > 0 ? pv / vol : null;
  }
  return out;
}

/** Money Flow Index — RSI weighted by volume. Range 0-100. */
export function mfi(candles: Candle[], period = 14): Series {
  const out: Series = new Array(candles.length).fill(null);
  if (candles.length <= period) return out;
  const typical = candles.map((c) => (c.high + c.low + c.close) / 3);

  for (let i = period; i < candles.length; i++) {
    let positive = 0;
    let negative = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const flow = typical[j] * candles[j].volume;
      if (typical[j] > typical[j - 1]) positive += flow;
      else if (typical[j] < typical[j - 1]) negative += flow;
    }
    out[i] = negative === 0 ? 100 : 100 - 100 / (1 + positive / negative);
  }
  return out;
}

/** Current volume relative to its own average — the "is anyone here" check. */
export function relativeVolume(candles: Candle[], period = 20): number | null {
  if (candles.length < period + 1) return null;
  const recent = candles.slice(-period - 1, -1);
  const avg = recent.reduce((a, c) => a + c.volume, 0) / recent.length;
  if (avg <= 0) return null;
  return candles[candles.length - 1].volume / avg;
}

// ============================================================================
// Market structure: pivots, levels, channels
// ============================================================================

/**
 * Bars required on each side of a pivot.
 *
 * A single shared value on purpose. When this was computed independently at
 * each call site as `length >= 120 ? 4 : 3`, the definition of a pivot — and
 * therefore every support, resistance and stop base derived from it — flipped
 * the moment a series crossed 120 bars. Harmless on a live call, fatal in any
 * walk-forward evaluation, where the same bar would be read two different ways
 * depending on how much history preceded it.
 */
export const PIVOT_LOOKBACK = 3;

export interface SwingPoint {
  index: number;
  date: string;
  price: number;
  type: 'high' | 'low';
}

/**
 * Fractal swing points: a bar whose high exceeds `lookback` bars on both sides
 * (or whose low undercuts them). These are where actual supply and demand
 * turned, which is what makes them better stop placement than a round number.
 *
 * A pivot must be >= every bar in the window AND strictly greater than at
 * least one bar on each side. Without the strict part a flat plateau registers
 * every one of its bars as both a high and a low, which poisons the
 * support/resistance clustering with levels where nothing actually turned.
 */
export function swingPoints(candles: Candle[], lookback = 3): SwingPoint[] {
  const points: SwingPoint[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const leftSide = candles.slice(i - lookback, i);
    const rightSide = candles.slice(i + 1, i + lookback + 1);
    const bar = candles[i];

    const isHigh =
      leftSide.every((c) => c.high <= bar.high) &&
      rightSide.every((c) => c.high <= bar.high) &&
      leftSide.some((c) => c.high < bar.high) &&
      rightSide.some((c) => c.high < bar.high);

    const isLow =
      leftSide.every((c) => c.low >= bar.low) &&
      rightSide.every((c) => c.low >= bar.low) &&
      leftSide.some((c) => c.low > bar.low) &&
      rightSide.some((c) => c.low > bar.low);

    if (isHigh) points.push({ index: i, date: bar.date, price: bar.high, type: 'high' });
    if (isLow) points.push({ index: i, date: bar.date, price: bar.low, type: 'low' });
  }
  return points;
}

export interface Level {
  price: number;
  /** How many independent swings formed at this price. */
  touches: number;
  /** Most recent bar index that touched it — recency beats age. */
  lastIndex: number;
  type: 'support' | 'resistance';
  /** touches × recency, used to rank. */
  strength: number;
}

/**
 * Cluster swing points into support/resistance levels.
 *
 * Prices that were tested repeatedly matter more than prices touched once, and
 * a level from last month matters more than one from last year. Clustering
 * tolerance scales with ATR so the same code works on a $3 stock and BTC.
 */
export function supportResistance(
  candles: Candle[],
  currentPrice: number,
  opts: { lookback?: number; tolerancePercent?: number; maxLevels?: number; recencyHalfLifeBars?: number } = {},
): { support: Level[]; resistance: Level[] } {
  const { lookback = 3, maxLevels = 5, recencyHalfLifeBars = 50 } = opts;
  const points = swingPoints(candles, lookback);
  if (points.length === 0) return { support: [], resistance: [] };

  // Default tolerance from ATR: levels are zones, and their width should be
  // the instrument's own noise, not an arbitrary percentage.
  const atrPct = last(atrPercent(candles, 14));
  const tolerance = opts.tolerancePercent ?? Math.min(Math.max(atrPct ?? 1.5, 0.5), 4);

  const clusters: Array<{ prices: number[]; indices: number[] }> = [];
  for (const p of [...points].sort((a, b) => a.price - b.price)) {
    const target = clusters[clusters.length - 1];
    const anchor = target ? target.prices[0] : null;
    if (anchor !== null && Math.abs((p.price - anchor) / anchor) * 100 <= tolerance) {
      target.prices.push(p.price);
      target.indices.push(p.index);
    } else {
      clusters.push({ prices: [p.price], indices: [p.index] });
    }
  }

  const total = candles.length;
  const levels: Level[] = clusters.map((c) => {
    const price = c.prices.reduce((a, b) => a + b, 0) / c.prices.length;
    const lastIndex = Math.max(...c.indices);
    // Recency decays by ABSOLUTE bars since the level was last touched, not as
    // a fraction of the window. Normalising by window length made the same
    // level score differently depending only on how much history the caller
    // happened to pass in: a touch 50 bars ago scored 0.58 in a 120-bar window
    // and 0.87 in a 400-bar one, which reordered the levels and therefore moved
    // the stop derived from them. Half-life decay is window-independent.
    const barsAgo = Math.max(0, total - 1 - lastIndex);
    const decay = 0.5 ** (barsAgo / recencyHalfLifeBars);
    return {
      price: round(price, 4),
      touches: c.prices.length,
      lastIndex,
      type: price < currentPrice ? ('support' as const) : ('resistance' as const),
      // An old but heavily-tested level keeps a quarter of its weight: price
      // remembers where it was rejected repeatedly, even a year later.
      strength: round(c.prices.length * (0.25 + 0.75 * decay), 3),
    };
  });

  const support = levels
    .filter((l) => l.type === 'support')
    .sort((a, b) => b.price - a.price)
    .slice(0, maxLevels);
  const resistance = levels
    .filter((l) => l.type === 'resistance')
    .sort((a, b) => a.price - b.price)
    .slice(0, maxLevels);

  return { support, resistance };
}

export interface DonchianResult {
  upper: Series;
  lower: Series;
  middle: Series;
}

/** Donchian channel — the highest high and lowest low of the last `period` bars. */
export function donchian(candles: Candle[], period = 20): DonchianResult {
  const upper: Series = new Array(candles.length).fill(null);
  const lower: Series = new Array(candles.length).fill(null);
  const middle: Series = new Array(candles.length).fill(null);
  for (let i = period - 1; i < candles.length; i++) {
    const window = candles.slice(i - period + 1, i + 1);
    const hh = Math.max(...window.map((c) => c.high));
    const ll = Math.min(...window.map((c) => c.low));
    upper[i] = hh;
    lower[i] = ll;
    middle[i] = (hh + ll) / 2;
  }
  return { upper, lower, middle };
}

/** Classic floor-trader pivots from the prior bar — the day trader's map. */
export function pivotPoints(prev: Candle): {
  pivot: number;
  r1: number;
  r2: number;
  r3: number;
  s1: number;
  s2: number;
  s3: number;
} {
  const p = (prev.high + prev.low + prev.close) / 3;
  const range = prev.high - prev.low;
  return {
    pivot: round(p, 4),
    r1: round(2 * p - prev.low, 4),
    r2: round(p + range, 4),
    r3: round(prev.high + 2 * (p - prev.low), 4),
    s1: round(2 * p - prev.high, 4),
    s2: round(p - range, 4),
    s3: round(prev.low - 2 * (prev.high - p), 4),
  };
}

/** Fibonacci retracement levels between a swing low and high. */
export function fibonacci(low: number, high: number): Record<string, number> {
  const range = high - low;
  return {
    '0': round(high, 4),
    '23.6': round(high - range * 0.236, 4),
    '38.2': round(high - range * 0.382, 4),
    '50': round(high - range * 0.5, 4),
    '61.8': round(high - range * 0.618, 4),
    '78.6': round(high - range * 0.786, 4),
    '100': round(low, 4),
    // Extensions, for targets once the prior high gives way.
    '161.8': round(high + range * 0.618, 4),
  };
}

// ============================================================================
// Divergence
// ============================================================================

export interface Divergence {
  type: 'bullish' | 'bearish';
  /** 'regular' warns of reversal; 'hidden' confirms trend continuation. */
  kind: 'regular' | 'hidden';
  priceFrom: number;
  priceTo: number;
  oscillatorFrom: number;
  oscillatorTo: number;
  barsAgo: number;
}

/**
 * Detect divergence between price and an oscillator over the recent window.
 *
 * Regular bearish: price makes a higher high, the oscillator does not — the
 * move is running on fumes. Hidden bullish: price makes a higher low while the
 * oscillator makes a lower low — a pullback inside an intact uptrend.
 *
 * Only the two most recent qualifying swings are compared. Chaining further
 * back finds "divergences" that no longer describe the current move.
 */
export function detectDivergence(
  candles: Candle[],
  oscillator: Series,
  opts: { lookback?: number; window?: number } = {},
): Divergence[] {
  const { lookback = 3, window = 60 } = opts;
  const start = Math.max(0, candles.length - window);
  const recent = candles.slice(start);
  const points = swingPoints(recent, lookback);
  const found: Divergence[] = [];

  const oscAt = (i: number): number | null => {
    const v = oscillator[start + i];
    return isNum(v) ? v : null;
  };

  const highs = points.filter((p) => p.type === 'high').slice(-2);
  if (highs.length === 2) {
    const [a, b] = highs;
    const oa = oscAt(a.index);
    const ob = oscAt(b.index);
    if (oa !== null && ob !== null) {
      if (b.price > a.price && ob < oa) {
        found.push({ type: 'bearish', kind: 'regular', priceFrom: a.price, priceTo: b.price, oscillatorFrom: round(oa, 2), oscillatorTo: round(ob, 2), barsAgo: recent.length - 1 - b.index });
      } else if (b.price < a.price && ob > oa) {
        found.push({ type: 'bearish', kind: 'hidden', priceFrom: a.price, priceTo: b.price, oscillatorFrom: round(oa, 2), oscillatorTo: round(ob, 2), barsAgo: recent.length - 1 - b.index });
      }
    }
  }

  const lows = points.filter((p) => p.type === 'low').slice(-2);
  if (lows.length === 2) {
    const [a, b] = lows;
    const oa = oscAt(a.index);
    const ob = oscAt(b.index);
    if (oa !== null && ob !== null) {
      if (b.price < a.price && ob > oa) {
        found.push({ type: 'bullish', kind: 'regular', priceFrom: a.price, priceTo: b.price, oscillatorFrom: round(oa, 2), oscillatorTo: round(ob, 2), barsAgo: recent.length - 1 - b.index });
      } else if (b.price > a.price && ob < oa) {
        found.push({ type: 'bullish', kind: 'hidden', priceFrom: a.price, priceTo: b.price, oscillatorFrom: round(oa, 2), oscillatorTo: round(ob, 2), barsAgo: recent.length - 1 - b.index });
      }
    }
  }

  return found;
}

// ============================================================================
// Cross-asset
// ============================================================================

/** Pearson correlation of the two series' returns. Both must be same-length. */
export function correlation(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  const ra: number[] = [];
  const rb: number[] = [];
  for (let i = 1; i < n; i++) {
    if (a[i - 1] === 0 || b[i - 1] === 0) continue;
    ra.push((a[i] - a[i - 1]) / a[i - 1]);
    rb.push((b[i] - b[i - 1]) / b[i - 1]);
  }
  if (ra.length < 2) return null;
  const ma = ra.reduce((x, y) => x + y, 0) / ra.length;
  const mb = rb.reduce((x, y) => x + y, 0) / rb.length;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < ra.length; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  const den = Math.sqrt(da * db);
  return den === 0 ? null : num / den;
}

/** Beta of `asset` against `benchmark`, from their return series. */
export function beta(asset: number[], benchmark: number[]): number | null {
  const n = Math.min(asset.length, benchmark.length);
  if (n < 3) return null;
  const ra: number[] = [];
  const rb: number[] = [];
  for (let i = 1; i < n; i++) {
    if (asset[i - 1] === 0 || benchmark[i - 1] === 0) continue;
    ra.push((asset[i] - asset[i - 1]) / asset[i - 1]);
    rb.push((benchmark[i] - benchmark[i - 1]) / benchmark[i - 1]);
  }
  if (ra.length < 2) return null;
  const ma = ra.reduce((x, y) => x + y, 0) / ra.length;
  const mb = rb.reduce((x, y) => x + y, 0) / rb.length;
  let cov = 0;
  let varB = 0;
  for (let i = 0; i < ra.length; i++) {
    cov += (ra[i] - ma) * (rb[i] - mb);
    varB += (rb[i] - mb) ** 2;
  }
  return varB === 0 ? null : cov / varB;
}
