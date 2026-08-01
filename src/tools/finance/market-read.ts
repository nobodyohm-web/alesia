/**
 * Market read — turn a candle series into a structured, decidable state.
 *
 * The point is to collapse a chart into facts a model can reason over without
 * hallucinating: is it trending or ranging, where did supply and demand
 * actually turn, how wide is a normal bar, is anyone trading it. Everything
 * here is derived from the candles alone. No opinions, no verdicts — those
 * belong to the layer above, which can then be audited against these numbers.
 */
import {
  adx,
  atr,
  atrPercent,
  bollinger,
  donchian,
  detectDivergence,
  ema,
  last,
  at,
  macd,
  maxDrawdown,
  mfi,
  obv,
  pivotPoints,
  realizedVolatility,
  regressionSlope,
  relativeVolume,
  roc,
  round,
  rsi,
  squeeze,
  stochRsi,
  supportResistance,
  swingPoints,
  PIVOT_LOOKBACK,
  vwap,
  type Candle,
  type Divergence,
  type Level,
} from './indicators.js';

export type TrendDirection = 'up' | 'down' | 'sideways';
export type Regime = 'trending' | 'ranging' | 'volatile-expansion' | 'compressed';

export interface TrendRead {
  direction: TrendDirection;
  /** ADX: <20 no trend, 20-25 emerging, >25 trending, >40 strong. */
  strength: number | null;
  strengthLabel: string;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  /** Price relative to each EMA, in percent. */
  priceVsEma20: number | null;
  priceVsEma50: number | null;
  priceVsEma200: number | null;
  /** 'golden' = 50 above 200, 'death' = below. Null when 200 is unavailable. */
  maRegime: 'golden' | 'death' | null;
  /** Least-squares slope over 20 bars, percent per bar. */
  slope: number | null;
  /** Swing structure: higher-highs/higher-lows and friends. */
  structure: 'HH-HL' | 'LH-LL' | 'HH-LL' | 'LH-HL' | 'unclear';
  /**
   * How `direction` was established. 'adx' means a real trend confirmed by the
   * directional indicators; 'slope' means ADX said there is no trend and the
   * direction is only a drift. Downstream scoring must not treat the two as
   * equally reliable — that is how a flat market gets full marks for bias.
   */
  directionSource: 'adx' | 'slope' | 'none';
}

export interface MomentumRead {
  rsi: number | null;
  rsiState: 'overbought' | 'bullish' | 'neutral' | 'bearish' | 'oversold' | null;
  /** RSI 5 bars ago, so the model can see direction rather than a snapshot. */
  rsiPrior: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  macdCross: 'bullish' | 'bearish' | null;
  stochRsiK: number | null;
  stochRsiState: 'overbought' | 'oversold' | 'neutral' | null;
  roc10: number | null;
}

export interface VolatilityRead {
  atr: number | null;
  atrPercent: number | null;
  bollingerBandwidth: number | null;
  percentB: number | null;
  /** True when Bollinger sits inside Keltner: compression before expansion. */
  inSqueeze: boolean | null;
  /** A squeeze that ended on the last bar — the "it is happening now" flag. */
  squeezeReleased: boolean;
  annualisedVolatility: number | null;
  maxDrawdown: number | null;
}

export interface VolumeRead {
  relativeVolume: number | null;
  obvTrend: 'accumulation' | 'distribution' | 'flat' | null;
  mfi: number | null;
  vwap: number | null;
  priceVsVwap: number | null;
}

export interface LevelsRead {
  support: Level[];
  resistance: Level[];
  nearestSupport: number | null;
  nearestResistance: number | null;
  /** Distance to the nearest level, in ATR units — the only comparable measure. */
  supportDistanceAtr: number | null;
  resistanceDistanceAtr: number | null;
  donchianHigh: number | null;
  donchianLow: number | null;
  /** Where price sits in the recent range: 0 = at the lows, 1 = at the highs. */
  rangePosition: number | null;
  pivots: ReturnType<typeof pivotPoints> | null;
}

export interface MarketRead {
  bars: number;
  lastDate: string;
  price: number;
  regime: Regime;
  trend: TrendRead;
  momentum: MomentumRead;
  volatility: VolatilityRead;
  volume: VolumeRead;
  levels: LevelsRead;
  divergences: Divergence[];
  /** Plain-language observations, each traceable to a number above. */
  signals: string[];
}

const pct = (a: number, b: number): number | null => (b === 0 ? null : round(((a - b) / b) * 100, 2));

/**
 * Classify swing structure from the last two highs and lows.
 * Higher highs with higher lows is the textbook uptrend; the mixed cases
 * (HH-LL = broadening, LH-HL = contracting triangle) matter because both mean
 * "do not trade this as a trend".
 */
function readStructure(candles: Candle[], lookback: number): TrendRead['structure'] {
  const points = swingPoints(candles, lookback);
  const highs = points.filter((p) => p.type === 'high').slice(-2);
  const lows = points.filter((p) => p.type === 'low').slice(-2);
  if (highs.length < 2 || lows.length < 2) return 'unclear';
  const higherHigh = highs[1].price > highs[0].price;
  const higherLow = lows[1].price > lows[0].price;
  if (higherHigh && higherLow) return 'HH-HL';
  if (!higherHigh && !higherLow) return 'LH-LL';
  if (higherHigh && !higherLow) return 'HH-LL';
  return 'LH-HL';
}

function strengthLabel(value: number | null): string {
  if (value === null) return 'unknown';
  if (value < 20) return 'no trend';
  if (value < 25) return 'emerging';
  if (value < 40) return 'trending';
  return 'strong trend';
}

/**
 * Compute the full read for one timeframe.
 *
 * `barsPerYear` differs between a 24/7 crypto market and a 252-day equity
 * calendar; passing it in is what keeps annualised volatility honest.
 */
export function analyzeTimeframe(candles: Candle[], barsPerYear = 252): MarketRead | null {
  // Below ~60 bars, EMA50 and ADX are either undefined or dominated by their
  // seed. Returning a partial read invites the model to trust numbers that
  // carry no information, so refuse instead.
  if (candles.length < 30) return null;

  const closes = candles.map((c) => c.close);
  const price = closes[closes.length - 1];
  const lastCandle = candles[candles.length - 1];

  // --- Trend -------------------------------------------------------------
  const e20 = last(ema(closes, 20));
  const e50 = candles.length >= 50 ? last(ema(closes, 50)) : null;
  const e200 = candles.length >= 200 ? last(ema(closes, 200)) : null;
  const adxRead = adx(candles, 14);
  const adxValue = last(adxRead.adx);
  const plusDi = last(adxRead.plusDI);
  const minusDi = last(adxRead.minusDI);
  const slope = regressionSlope(closes, Math.min(20, candles.length));
  const lookback = PIVOT_LOOKBACK;
  const structure = readStructure(candles, lookback);

  let direction: TrendDirection = 'sideways';
  let directionSource: TrendRead['directionSource'] = 'none';
  if (adxValue !== null && adxValue >= 20 && plusDi !== null && minusDi !== null) {
    direction = plusDi > minusDi ? 'up' : 'down';
    directionSource = 'adx';
  } else if (slope !== null && Math.abs(slope) > 0.1) {
    // Below the ADX threshold, fall back to the regression slope so a quiet
    // drift is not reported as flat — but record that it is only a drift.
    direction = slope > 0 ? 'up' : 'down';
    directionSource = 'slope';
  }

  const trend: TrendRead = {
    direction,
    strength: adxValue !== null ? round(adxValue, 1) : null,
    strengthLabel: strengthLabel(adxValue),
    ema20: e20 !== null ? round(e20, 4) : null,
    ema50: e50 !== null ? round(e50, 4) : null,
    ema200: e200 !== null ? round(e200, 4) : null,
    priceVsEma20: e20 !== null ? pct(price, e20) : null,
    priceVsEma50: e50 !== null ? pct(price, e50) : null,
    priceVsEma200: e200 !== null ? pct(price, e200) : null,
    maRegime: e50 !== null && e200 !== null ? (e50 > e200 ? 'golden' : 'death') : null,
    slope: slope !== null ? round(slope, 4) : null,
    structure,
    directionSource,
  };

  // --- Momentum ----------------------------------------------------------
  const rsiSeries = rsi(closes, 14);
  const rsiValue = last(rsiSeries);
  const macdRead = macd(closes);
  const macdLine = last(macdRead.macd);
  const macdSignal = last(macdRead.signal);
  const histNow = at(macdRead.histogram, 0);
  const histPrev = at(macdRead.histogram, 1);
  const stochK = last(stochRsi(closes).k);

  const momentum: MomentumRead = {
    rsi: rsiValue !== null ? round(rsiValue, 1) : null,
    rsiState:
      rsiValue === null
        ? null
        : rsiValue >= 70
          ? 'overbought'
          : rsiValue >= 55
            ? 'bullish'
            : rsiValue > 45
              ? 'neutral'
              : rsiValue > 30
                ? 'bearish'
                : 'oversold',
    rsiPrior: at(rsiSeries, 5) !== null ? round(at(rsiSeries, 5) as number, 1) : null,
    macd: macdLine !== null ? round(macdLine, 4) : null,
    macdSignal: macdSignal !== null ? round(macdSignal, 4) : null,
    macdHistogram: histNow !== null ? round(histNow, 4) : null,
    // A cross is a sign change on the histogram between the last two bars,
    // which is the event, not the level.
    macdCross:
      histNow !== null && histPrev !== null && histNow > 0 !== histPrev > 0
        ? histNow > 0
          ? 'bullish'
          : 'bearish'
        : null,
    stochRsiK: stochK !== null ? round(stochK, 1) : null,
    stochRsiState: stochK === null ? null : stochK >= 80 ? 'overbought' : stochK <= 20 ? 'oversold' : 'neutral',
    roc10: last(roc(closes, 10)) !== null ? round(last(roc(closes, 10)) as number, 2) : null,
  };

  // --- Volatility --------------------------------------------------------
  const atrValue = last(atr(candles, 14));
  const atrPct = last(atrPercent(candles, 14));
  const bb = bollinger(closes, 20, 2);
  const squeezeSeries = squeeze(candles);
  const squeezeNow = squeezeSeries[squeezeSeries.length - 1] ?? null;
  const squeezePrev = squeezeSeries[squeezeSeries.length - 2] ?? null;

  const volatility: VolatilityRead = {
    atr: atrValue !== null ? round(atrValue, 4) : null,
    atrPercent: atrPct !== null ? round(atrPct, 2) : null,
    bollingerBandwidth: last(bb.bandwidth) !== null ? round(last(bb.bandwidth) as number, 2) : null,
    percentB: last(bb.percentB) !== null ? round(last(bb.percentB) as number, 3) : null,
    inSqueeze: squeezeNow,
    squeezeReleased: squeezePrev === true && squeezeNow === false,
    annualisedVolatility:
      realizedVolatility(closes, Math.min(20, closes.length - 1), barsPerYear) !== null
        ? round(realizedVolatility(closes, Math.min(20, closes.length - 1), barsPerYear) as number, 1)
        : null,
    maxDrawdown: maxDrawdown(closes) !== null ? round(maxDrawdown(closes) as number, 2) : null,
  };

  // --- Volume ------------------------------------------------------------
  const obvSeries = obv(candles);
  const obvNow = last(obvSeries);
  const obvPast = at(obvSeries, Math.min(20, candles.length - 1));
  const vwapValue = last(vwap(candles, Math.min(20, candles.length)));
  const hasVolume = candles.some((c) => c.volume > 0);

  const volumeRead: VolumeRead = {
    relativeVolume: relativeVolume(candles, 20) !== null ? round(relativeVolume(candles, 20) as number, 2) : null,
    obvTrend:
      !hasVolume || obvNow === null || obvPast === null
        ? null
        : obvNow > obvPast
          ? 'accumulation'
          : obvNow < obvPast
            ? 'distribution'
            : 'flat',
    mfi: last(mfi(candles, 14)) !== null ? round(last(mfi(candles, 14)) as number, 1) : null,
    vwap: vwapValue !== null ? round(vwapValue, 4) : null,
    priceVsVwap: vwapValue !== null ? pct(price, vwapValue) : null,
  };

  // --- Levels ------------------------------------------------------------
  const { support, resistance } = supportResistance(candles, price, { lookback, maxLevels: 4 });
  const don = donchian(candles, Math.min(20, candles.length));
  const donHigh = last(don.upper);
  const donLow = last(don.lower);
  const nearestSupport = support[0]?.price ?? null;
  const nearestResistance = resistance[0]?.price ?? null;

  const levels: LevelsRead = {
    support,
    resistance,
    nearestSupport,
    nearestResistance,
    supportDistanceAtr:
      nearestSupport !== null && atrValue ? round((price - nearestSupport) / atrValue, 2) : null,
    resistanceDistanceAtr:
      nearestResistance !== null && atrValue ? round((nearestResistance - price) / atrValue, 2) : null,
    donchianHigh: donHigh !== null ? round(donHigh, 4) : null,
    donchianLow: donLow !== null ? round(donLow, 4) : null,
    rangePosition:
      donHigh !== null && donLow !== null && donHigh !== donLow
        ? round((price - donLow) / (donHigh - donLow), 3)
        : null,
    pivots: candles.length >= 2 ? pivotPoints(candles[candles.length - 2]) : null,
  };

  // --- Regime ------------------------------------------------------------
  // Order matters: compression overrides "ranging" because it carries a
  // forecast (expansion) that a plain range does not. But it must NOT override
  // an established trend — a steady, low-deviation grind higher registers as a
  // squeeze while being the cleanest trend there is, and calling that
  // "compressed" would route it to a breakout entry instead of a pullback.
  let regime: Regime = 'ranging';
  const stronglyTrending = adxValue !== null && adxValue >= 30;
  if (squeezeNow === true && !stronglyTrending) regime = 'compressed';
  else if (adxValue !== null && adxValue >= 25) regime = 'trending';
  else if (volatility.bollingerBandwidth !== null && atrPct !== null && atrPct > 4) regime = 'volatile-expansion';

  // --- Divergences -------------------------------------------------------
  const divergences = detectDivergence(candles, rsiSeries, { lookback, window: Math.min(60, candles.length) });

  // --- Signals -----------------------------------------------------------
  const signals: string[] = [];
  if (trend.maRegime === 'golden') signals.push('EMA50 above EMA200 — long-term regime is constructive');
  if (trend.maRegime === 'death') signals.push('EMA50 below EMA200 — long-term regime is defensive');
  if (adxValue !== null && adxValue < 20) signals.push(`ADX ${round(adxValue, 1)} — no trend; trend-following entries are low-quality here`);
  if (structure === 'HH-HL') signals.push('Higher highs and higher lows — intact uptrend structure');
  if (structure === 'LH-LL') signals.push('Lower highs and lower lows — intact downtrend structure');
  if (momentum.rsiState === 'oversold') signals.push(`RSI ${momentum.rsi} — oversold`);
  if (momentum.rsiState === 'overbought') signals.push(`RSI ${momentum.rsi} — overbought`);
  if (momentum.macdCross) signals.push(`MACD histogram crossed ${momentum.macdCross} on the last bar`);
  if (squeezeNow === true) signals.push('Volatility compressed (Bollinger inside Keltner) — expansion pending, direction unresolved');
  if (volatility.squeezeReleased) signals.push('Squeeze just released — the expansion is starting now');
  if (volumeRead.relativeVolume !== null && volumeRead.relativeVolume > 1.5)
    signals.push(`Volume ${volumeRead.relativeVolume}x its 20-bar average — participation confirms the move`);
  if (volumeRead.relativeVolume !== null && volumeRead.relativeVolume < 0.6)
    signals.push(`Volume ${volumeRead.relativeVolume}x average — move lacks participation`);
  for (const d of divergences) {
    signals.push(
      `${d.kind} ${d.type} RSI divergence ${d.barsAgo} bars ago (price ${d.priceFrom}→${d.priceTo}, RSI ${d.oscillatorFrom}→${d.oscillatorTo})`,
    );
  }
  if (levels.rangePosition !== null && levels.rangePosition > 0.95)
    signals.push('Price at the top of its 20-bar range — breakout or rejection zone');
  if (levels.rangePosition !== null && levels.rangePosition < 0.05)
    signals.push('Price at the bottom of its 20-bar range — breakdown or reversal zone');

  return {
    bars: candles.length,
    lastDate: lastCandle.date,
    price: round(price, 4),
    regime,
    trend,
    momentum,
    volatility,
    volume: volumeRead,
    levels,
    divergences,
    signals,
  };
}
