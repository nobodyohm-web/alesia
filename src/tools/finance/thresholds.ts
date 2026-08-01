/**
 * Decision thresholds — every number the engine uses to make a call.
 *
 * These were scattered as literals across market-read.ts and trade-setup.ts.
 * Collecting them here is what makes them sweepable: a threshold that cannot be
 * varied cannot be calibrated, and a threshold that is never calibrated is
 * folklore with a decimal point.
 *
 * The defaults are the conventional values found in the literature. They are
 * defensible starting points, NOT measurements. Anything the backtest promotes
 * to a measured value should be recorded as such, with the sample it came from.
 */

export interface Thresholds {
  /** ADX below this means no trend, and direction falls back to the slope. */
  adxDirectionGate: number;
  /** ADX at or above this labels the regime "trending". */
  adxTrendingRegime: number;
  /** ADX at or above this is strong enough that a squeeze must not override it. */
  adxStrongTrend: number;
  /** ADX the setup engine requires before it will trend-follow. */
  adxSetupTrending: number;
  /** Minimum |slope| (percent per bar) to call a drift a direction at all. */
  driftSlopeMin: number;

  /** RSI bands used to label momentum state. */
  rsiOverbought: number;
  rsiBullish: number;
  rsiNeutralLow: number;
  rsiOversold: number;

  /** Stochastic RSI extremes. */
  stochOverbought: number;
  stochOversold: number;

  /** RSI beyond which a trend entry is "chasing" rather than joining. */
  rsiExtendedLong: number;
  rsiExtendedShort: number;

  /** Distance from EMA20 in ATR beyond which price is too extended to enter. */
  stretchedAtr: number;
  /** Distance from EMA20 in ATR within which price counts as having pulled back. */
  nearMeanAtr: number;

  /** Range position below/above which mean reversion is the only available edge. */
  rangeLowThird: number;
  rangeHighThird: number;

  /** Confidence: RSI headroom cutoff for the momentum factor. */
  rsiHeadroomLong: number;
  rsiHeadroomShort: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  adxDirectionGate: 20,
  adxTrendingRegime: 25,
  adxStrongTrend: 30,
  adxSetupTrending: 22,
  driftSlopeMin: 0.1,

  rsiOverbought: 70,
  rsiBullish: 55,
  rsiNeutralLow: 45,
  rsiOversold: 30,

  stochOverbought: 80,
  stochOversold: 20,

  rsiExtendedLong: 72,
  rsiExtendedShort: 28,

  stretchedAtr: 2,
  nearMeanAtr: 1,

  rangeLowThird: 0.3,
  rangeHighThird: 0.7,

  rsiHeadroomLong: 68,
  rsiHeadroomShort: 32,
};

/** Build a threshold set from a partial override, for sweeps. */
export function withThresholds(overrides: Partial<Thresholds>): Thresholds {
  return { ...DEFAULT_THRESHOLDS, ...overrides };
}
