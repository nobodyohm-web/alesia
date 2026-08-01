/**
 * Trade setup engine — the answer to "when do I buy, and where do I get out".
 *
 * Everything here is derived from market structure, never from a round number
 * or a fixed percentage of an intrinsic value. A stop belongs below the level
 * where the thesis is actually wrong; a target belongs at the level where
 * supply actually sits. The reward:risk that falls out of those two is the
 * only number that decides whether the trade is worth taking.
 *
 * The engine is deliberately willing to say "stand aside". Most of the time,
 * for most instruments, there is no setup — and an agent that always produces
 * an entry price is an agent that loses money politely.
 */
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { getCandles, type Market } from './candles.js';
import { analyzeTimeframe, type MarketRead } from './market-read.js';
import { HORIZONS, HORIZON_DOCTRINE, type Horizon } from './horizons.js';
import { round, swingPoints, PIVOT_LOOKBACK, type Candle } from './indicators.js';
import { DEFAULT_THRESHOLDS, type Thresholds } from './thresholds.js';
import { calibrationFor } from './calibration.js';

export type Direction = 'long' | 'short';
export type Timing = 'enter-now' | 'wait-pullback' | 'wait-breakout' | 'wait-confirmation' | 'stand-aside';
export type Strategy = 'trend-pullback' | 'breakout' | 'range-reversion' | 'reversal' | 'none';

export interface ConfidenceFactor {
  factor: string;
  points: number;
  max: number;
  note: string;
}

export interface Target {
  label: string;
  price: number;
  rMultiple: number;
  basis: string;
}

export interface TradeSetup {
  direction: Direction | 'none';
  strategy: Strategy;
  timing: Timing;
  trigger: string;
  entry: { ideal: number; zoneLow: number; zoneHigh: number } | null;
  stop: {
    price: number;
    method: string;
    distancePercent: number;
    distanceAtr: number;
    /** True when structure was too far and the stop fell back to volatility. */
    structuralCapped: boolean;
  } | null;
  targets: Target[];
  riskReward: number | null;
  invalidation: string;
  confidence: { score: number; factors: ConfidenceFactor[] };
  warnings: string[];
}

const TradeSetupSchema = z.object({
  symbol: z.string().min(1).describe("Ticker or pair, e.g. 'NVDA', 'AAPL', 'BTC', 'BTCUSDT'"),
  horizon: z
    .enum(['day', 'swing', 'medium', 'long'])
    .default('swing')
    .describe(
      "Trading horizon. 'day' = intraday (1h/15m/5m), 'swing' = days to weeks (1d/4h/1h), 'medium' = weeks to months (1wk/1d), 'long' = months to years (1wk). Defaults to 'swing'.",
    ),
  direction: z
    .enum(['auto', 'long', 'short'])
    .default('auto')
    .describe(
      "'auto' lets the higher timeframe decide the bias (recommended). Forcing a side against the trend is allowed but penalised in the confidence score.",
    ),
  market: z.enum(['auto', 'equity', 'crypto']).default('auto').describe("Venue. 'auto' infers it from the symbol."),
  accountSize: z
    .number()
    .positive()
    .optional()
    .describe('Account size in the quote currency. Supplied only when position sizing is wanted.'),
  riskPercent: z
    .number()
    .min(0.1)
    .max(10)
    .default(1)
    .describe('Percent of the account risked if the stop is hit. Defaults to 1%.'),
});

/** Most recent swing low/high on the structure timeframe — where the stop belongs. */
function recentSwing(candles: Candle[], type: 'high' | 'low', lookback: number): number | null {
  const points = swingPoints(candles, lookback).filter((p) => p.type === type);
  return points.length > 0 ? points[points.length - 1].price : null;
}

/**
 * Choose the strategy from the market state, not from a preference.
 *
 * The order encodes priority: a volatility squeeze is a stronger statement
 * about what happens next than a trend reading, and an extended trend is a
 * reason to wait rather than a reason to buy.
 */
export function chooseStrategy(
  bias: Direction,
  structure: MarketRead,
  entry: MarketRead,
  t: Thresholds = DEFAULT_THRESHOLDS,
): { strategy: Strategy; timing: Timing; reason: string; directionOverride?: Direction } {
  const { regime, trend, momentum, levels, volatility } = structure;
  const atr = volatility.atr ?? 0;
  const distanceToMa =
    trend.ema20 !== null && atr > 0 ? Math.abs(structure.price - trend.ema20) / atr : null;

  if (regime === 'compressed') {
    return {
      strategy: 'breakout',
      timing: 'wait-breakout',
      reason: 'Volatility is compressed (Bollinger inside Keltner). Direction is unresolved until the range breaks, so the break itself is the entry.',
    };
  }

  const trending = trend.strength !== null && trend.strength >= t.adxSetupTrending;
  const aligned = (bias === 'long' && trend.direction === 'up') || (bias === 'short' && trend.direction === 'down');

  if (trending && aligned) {
    const extended =
      (bias === 'long' && (momentum.rsi ?? 50) > t.rsiExtendedLong) ||
      (bias === 'short' && (momentum.rsi ?? 50) < t.rsiExtendedShort);

    // Price this far from its own mean is a parabolic leg, not a trend to
    // join. A "pullback entry" here is anchored on an EMA several ATR below
    // the market: it either never fills, or it fills precisely because the
    // trend has broken. Standing aside is the honest answer.
    //
    // This branch used to return trend-pullback/wait-pullback — the same thing
    // the fall-through already produced for any distance above nearMeanAtr. The
    // threshold was therefore inert, which a sweep exposed: stretchedAtr at
    // 1.0, 1.5, 2.0 and 3.0 all yielded byte-identical results (n=2364,
    // exp=0.0727). A knob that cannot change an outcome is not a parameter.
    if (distanceToMa !== null && distanceToMa > t.stretchedAtr) {
      return {
        strategy: 'none',
        timing: 'stand-aside',
        reason: `Price sits ${round(distanceToMa, 1)} ATR from its EMA20 — a parabolic extension, not a trend to join. Any pullback deep enough to enter on would mean the trend has already broken.`,
      };
    }

    if (extended) {
      return {
        strategy: 'trend-pullback',
        timing: 'wait-pullback',
        reason: `Trend is intact but momentum is stretched (RSI ${momentum.rsi}). Entering here pays the worst price of the move.`,
      };
    }

    const nearMean = distanceToMa !== null && distanceToMa <= t.nearMeanAtr;
    return {
      strategy: 'trend-pullback',
      timing: nearMean ? 'enter-now' : 'wait-pullback',
      reason: nearMean
        ? 'Trend is intact and price has already returned to its moving average — this is the pullback.'
        : 'Trend is intact; wait for the pullback into the moving-average zone rather than chasing.',
    };
  }

  if (regime === 'ranging' || !trending) {
    const pos = levels.rangePosition;
    if (pos !== null) {
      if (bias === 'long' && pos < t.rangeLowThird) {
        return {
          strategy: 'range-reversion',
          timing: 'enter-now',
          reason: 'No trend, and price sits in the lower third of its range. Mean reversion is the only edge available here.',
        };
      }
      if (bias === 'short' && pos > t.rangeHighThird) {
        return {
          strategy: 'range-reversion',
          timing: 'enter-now',
          reason: 'No trend, and price sits in the upper third of its range.',
        };
      }
    }

    // A divergence plus an exhausted oscillator is the only counter-trend setup
    // worth naming; everything else is guessing.
    //
    // The direction comes from the EXCESS, not from the trend. This branch
    // previously demanded a long bias in an oversold market (or a short bias in
    // an overbought one) — conditions that exclude each other by construction,
    // since the bias is derived from the very trend producing the RSI reading.
    // It was therefore unreachable: a backtest found `exhausted` true 0 times
    // in 3,011 bars. Fading an extreme means trading AGAINST the prevailing
    // bias, so the setup carries its own direction.
    const reversalDirection: Direction | null =
      momentum.rsiState === 'oversold' ? 'long' : momentum.rsiState === 'overbought' ? 'short' : null;
    const supportive =
      reversalDirection !== null &&
      structure.divergences.some(
        (d) =>
          d.kind === 'regular' &&
          (reversalDirection === 'long' ? d.type === 'bullish' : d.type === 'bearish'),
      );
    if (reversalDirection !== null && supportive) {
      return {
        strategy: 'reversal',
        timing: 'wait-confirmation',
        directionOverride: reversalDirection,
        reason: `Regular ${reversalDirection === 'long' ? 'bullish' : 'bearish'} divergence with an ${momentum.rsiState} oscillator (RSI ${momentum.rsi}). Counter-trend against the ${bias} bias, so it needs confirmation on the entry timeframe before committing.`,
      };
    }

    return {
      strategy: 'none',
      timing: 'stand-aside',
      reason: `No trend (ADX ${structure.trend.strength ?? 'n/a'}) and price is mid-range. There is no edge here — waiting is the position.`,
    };
  }

  return {
    strategy: 'none',
    timing: 'stand-aside',
    reason: `The structure timeframe trends ${structure.trend.direction} while the higher timeframe sets a ${bias} bias. The timeframes disagree, and picking one is guessing — wait for them to line up.`,
  };
}

/** Assemble entry zone, stop and targets from the chosen strategy. */
export function buildLevels(
  bias: Direction,
  strategy: Strategy,
  structure: MarketRead,
  structureCandles: Candle[],
  spec: (typeof HORIZONS)[Horizon],
  lookback: number,
  /**
   * Optional replacement for ATR as the volatility unit every distance here is
   * measured in. Supplied when an implied-volatility series is available, since
   * IV forecasts the coming excursion measurably better than a trailing average
   * of past ranges does — and a stop is a bet on exactly that excursion.
   * Must already be expressed as a price distance per bar.
   */
  volatilityUnit?: number | null,
): { entry: TradeSetup['entry']; stop: TradeSetup['stop']; targets: Target[]; warnings: string[] } {
  const warnings: string[] = [];
  const price = structure.price;
  const atr = structure.volatility.atr;

  if (!atr || atr <= 0) {
    warnings.push('ATR unavailable — cannot size a stop from volatility. Levels are structural only.');
  }
  const a =
    volatilityUnit && volatilityUnit > 0
      ? volatilityUnit
      : atr && atr > 0
        ? atr
        : price * 0.02;

  const { levels, trend } = structure;
  const isLong = bias === 'long';

  // --- Entry zone --------------------------------------------------------
  let ideal: number;
  let zoneLow: number;
  let zoneHigh: number;

  if (strategy === 'breakout') {
    const level = isLong ? (levels.donchianHigh ?? price) : (levels.donchianLow ?? price);
    // Enter just beyond the range edge; a fill exactly at it is usually a wick.
    ideal = isLong ? level + 0.15 * a : level - 0.15 * a;
    zoneLow = isLong ? level : ideal - 0.5 * a;
    zoneHigh = isLong ? ideal + 0.5 * a : level;
  } else if (strategy === 'trend-pullback') {
    // The mean and the nearest level, whichever is the more conservative fill.
    const ma = trend.ema20 ?? price;
    const level = isLong ? levels.nearestSupport : levels.nearestResistance;
    ideal = level !== null ? (isLong ? Math.max(ma, level) : Math.min(ma, level)) : ma;
    zoneLow = ideal - 0.5 * a;
    zoneHigh = ideal + 0.5 * a;
  } else if (strategy === 'range-reversion') {
    const level = isLong ? (levels.nearestSupport ?? levels.donchianLow ?? price) : (levels.nearestResistance ?? levels.donchianHigh ?? price);
    ideal = level;
    zoneLow = level - 0.4 * a;
    zoneHigh = level + 0.4 * a;
  } else {
    // Reversal: enter only after the entry timeframe confirms, so anchor on
    // the current price rather than a level that may never be revisited.
    ideal = price;
    zoneLow = price - 0.5 * a;
    zoneHigh = price + 0.5 * a;
  }

  // --- Stop --------------------------------------------------------------
  const swing = recentSwing(structureCandles, isLong ? 'low' : 'high', lookback);
  const structural = isLong
    ? [levels.nearestSupport, swing, strategy === 'breakout' ? levels.donchianLow : null].filter(
        (v): v is number => v !== null && v < ideal,
      )
    : [levels.nearestResistance, swing, strategy === 'breakout' ? levels.donchianHigh : null].filter(
        (v): v is number => v !== null && v > ideal,
      );

  let stopBase: number;
  let method: string;
  if (structural.length > 0) {
    // The nearest valid structural level: a stop further away than necessary
    // is capital wasted, one closer than structure is a guaranteed shake-out.
    stopBase = isLong ? Math.max(...structural) : Math.min(...structural);
    method = `${spec.stopAtrMultiple} ATR beyond the nearest structural ${isLong ? 'support' : 'resistance'} (${round(stopBase, 4)})`;
  } else {
    stopBase = ideal;
    method = `${spec.stopAtrMultiple * 2} ATR from entry — no structural level available on this timeframe`;
    warnings.push('No structural level below the entry; the stop is pure volatility. Treat the setup as lower quality.');
  }

  const buffer = (structural.length > 0 ? spec.stopAtrMultiple : spec.stopAtrMultiple * 2) * a;
  let stopPrice = isLong ? stopBase - buffer : stopBase + buffer;
  let risk = Math.abs(ideal - stopPrice);

  // Cap the stop. A structural level 5 ATR away is real structure but not a
  // tradeable stop: it wrecks the R arithmetic every target depends on, and at
  // the long horizon it produced targets below zero.
  const atrLimit = spec.maxStopAtr * a;
  const percentLimit = (spec.maxStopPercent / 100) * ideal;
  const maxRisk = Math.min(atrLimit, percentLimit);
  let capped = false;
  if (risk > maxRisk && maxRisk > 0) {
    capped = true;
    // Report the full uncapped distance (structure PLUS the ATR buffer) and
    // name the ceiling that actually bound. Quoting the bare structure
    // distance against the ATR ceiling reads as a contradiction whenever it
    // was the percentage limit that triggered.
    const uncappedAtr = round(risk / a, 1);
    const uncappedPct = round((risk / ideal) * 100, 1);
    const binding = atrLimit <= percentLimit ? `${spec.maxStopAtr} ATR` : `${spec.maxStopPercent}% of price`;
    risk = maxRisk;
    stopPrice = isLong ? ideal - risk : ideal + risk;
    method = `volatility stop at ${round(risk / a, 2)} ATR — a stop beyond the nearest structure would have been ${uncappedAtr} ATR away`;
    warnings.push(
      `A stop placed beyond structure would sit ${uncappedAtr} ATR (${uncappedPct}%) from the entry, past the ${binding} ceiling for a ${spec.label.toLowerCase()} trade. The stop is volatility-based instead, so it sits inside the noise band rather than beyond structure — lower quality, and more likely to be hit by a move that does not invalidate the idea.`,
    );
  }

  if (risk <= 0) {
    return { entry: null, stop: null, targets: [], warnings: [...warnings, 'Degenerate stop distance; no setup.'] };
  }

  const stop = {
    price: round(stopPrice, 4),
    method,
    distancePercent: round((risk / ideal) * 100, 2),
    distanceAtr: round(risk / a, 2),
    structuralCapped: capped,
  };

  // --- Targets -----------------------------------------------------------
  const targets: Target[] = [];
  const opposing = isLong ? structure.levels.resistance : structure.levels.support;
  const rAt = (p: number): number => round(Math.abs(p - ideal) / risk, 2);

  // T1: the first opposing level, if it is far enough to be worth the trip.
  const first = opposing.find((l) => (isLong ? l.price > ideal + 0.8 * risk : l.price < ideal - 0.8 * risk));
  if (first) {
    targets.push({ label: 'T1', price: round(first.price, 4), rMultiple: rAt(first.price), basis: `first ${isLong ? 'resistance' : 'support'} (${first.touches} touches)` });
  } else {
    const p = isLong ? ideal + 1.5 * risk : ideal - 1.5 * risk;
    targets.push({ label: 'T1', price: round(p, 4), rMultiple: 1.5, basis: 'measured 1.5R — no structural level within reach' });
  }

  // T2: the next level beyond T1, else the horizon's minimum acceptable R.
  const second = opposing.find((l) => (isLong ? l.price > targets[0].price * 1.001 : l.price < targets[0].price * 0.999));
  if (second) {
    targets.push({ label: 'T2', price: round(second.price, 4), rMultiple: rAt(second.price), basis: `next ${isLong ? 'resistance' : 'support'}` });
  } else {
    const p = isLong ? ideal + spec.minRiskReward * risk : ideal - spec.minRiskReward * risk;
    targets.push({ label: 'T2', price: round(p, 4), rMultiple: spec.minRiskReward, basis: `${spec.minRiskReward}R — the minimum worth holding for at this horizon` });
  }

  // T3: the range projection — a measured move of the structure just broken.
  if (levels.donchianHigh !== null && levels.donchianLow !== null) {
    const span = levels.donchianHigh - levels.donchianLow;
    const p = isLong ? levels.donchianHigh + span : levels.donchianLow - span;
    if ((isLong && p > targets[1].price) || (!isLong && p < targets[1].price)) {
      targets.push({ label: 'T3', price: round(p, 4), rMultiple: rAt(p), basis: 'measured move — range height projected from the breakout' });
    }
  }

  // A short target below zero is arithmetic, not analysis. Nothing trades at a
  // negative price, so drop those rather than printing them.
  const valid = targets.filter((t) => t.price > 0);
  if (valid.length < targets.length) {
    warnings.push('Some projected targets fell at or below zero and were dropped — the risk unit is too large relative to the price for that many R.');
  }

  return { entry: { ideal: round(ideal, 4), zoneLow: round(zoneLow, 4), zoneHigh: round(zoneHigh, 4) }, stop, targets: valid, warnings };
}

/**
 * Score the setup out of 100 from named, auditable factors.
 *
 * Every point is traceable to a number in the market read. A score without its
 * factors is a black box, and a black box is not something anyone should size
 * a position from.
 */
export function scoreConfidence(
  bias: Direction,
  strategy: Strategy,
  trend: MarketRead,
  structure: MarketRead,
  entry: MarketRead,
  riskReward: number | null,
  spec: (typeof HORIZONS)[Horizon],
  forced: boolean,
  stopCapped: boolean,
): { score: number; factors: ConfidenceFactor[] } {
  const factors: ConfidenceFactor[] = [];
  const wantUp = bias === 'long';

  const htfAligned = wantUp ? trend.trend.direction === 'up' : trend.trend.direction === 'down';
  // A direction that only came from the regression slope means ADX found no
  // trend at all. Scoring it as a confirmed bias is how a flat chart ends up
  // with a high-conviction trade attached to it.
  const htfConfirmed = trend.trend.directionSource === 'adx';
  factors.push({
    factor: 'Higher-timeframe bias',
    points: htfAligned ? (htfConfirmed ? 25 : 12) : trend.trend.direction === 'sideways' ? 8 : 0,
    max: 25,
    note: htfAligned && !htfConfirmed
      ? `${trend.trend.direction} on the ${spec.trendTf} chart, but ADX ${trend.trend.strength ?? 'n/a'} means this is a drift, not a trend — half credit`
      : `${trend.trend.direction} on the ${spec.trendTf} chart (ADX ${trend.trend.strength ?? 'n/a'})`,
  });

  const stfAligned = wantUp ? structure.trend.direction === 'up' : structure.trend.direction === 'down';
  // HH-LL (broadening) and LH-HL (contracting) mean the swings disagree with
  // each other; neither is a trend to align with, whatever the direction says.
  const coherent = structure.trend.structure === 'HH-HL' || structure.trend.structure === 'LH-LL';
  factors.push({
    factor: 'Structure-timeframe alignment',
    points: stfAligned ? (coherent ? 15 : 8) : structure.trend.direction === 'sideways' ? 6 : 0,
    max: 15,
    note: `${structure.trend.direction} on the ${spec.structureTf} chart, structure ${structure.trend.structure}${
      stfAligned && !coherent ? ' — swings are incoherent (no clean trend structure), partial credit' : ''
    }`,
  });

  const adxValue = structure.trend.strength ?? 0;
  factors.push({
    factor: 'Trend strength',
    points: adxValue >= 30 ? 10 : adxValue >= 22 ? 7 : adxValue >= 18 ? 3 : 0,
    max: 10,
    note: `ADX ${round(adxValue, 1)} — ${structure.trend.strengthLabel}`,
  });

  const rsiValue = structure.momentum.rsi ?? 50;
  const roomToRun = wantUp ? rsiValue < DEFAULT_THRESHOLDS.rsiHeadroomLong : rsiValue > DEFAULT_THRESHOLDS.rsiHeadroomShort;
  factors.push({
    factor: 'Momentum headroom',
    points: roomToRun ? 10 : 2,
    max: 10,
    note: `RSI ${rsiValue}${roomToRun ? '' : ' — already stretched, most of the move is behind us'}`,
  });

  const rv = structure.volume.relativeVolume;
  const obvOk = wantUp ? structure.volume.obvTrend === 'accumulation' : structure.volume.obvTrend === 'distribution';
  factors.push({
    factor: 'Participation',
    points: (rv !== null && rv > 1.2 ? 5 : rv !== null && rv > 0.7 ? 3 : 0) + (obvOk ? 5 : 0),
    max: 10,
    note: `volume ${rv ?? 'n/a'}x average, OBV ${structure.volume.obvTrend ?? 'n/a'}`,
  });

  factors.push({
    factor: 'Reward:risk',
    points:
      riskReward === null ? 0 : riskReward >= spec.minRiskReward * 1.5 ? 20 : riskReward >= spec.minRiskReward ? 15 : riskReward >= 1.5 ? 7 : 0,
    max: 20,
    note: `${riskReward ?? 'n/a'}R to the primary target (minimum ${spec.minRiskReward}R at this horizon)`,
  });

  const opposing = structure.divergences.filter(
    (d) => d.kind === 'regular' && (wantUp ? d.type === 'bearish' : d.type === 'bullish'),
  );
  factors.push({
    factor: 'No opposing divergence',
    points: opposing.length === 0 ? 10 : 0,
    max: 10,
    note: opposing.length === 0 ? 'none detected' : `${opposing.length} regular divergence against the trade`,
  });

  // The entry timeframe is the trigger, so its momentum turning the right way
  // is what separates "the level is here" from "the level is holding".
  const entryConfirms = wantUp
    ? (entry.momentum.macdHistogram ?? 0) > 0 || entry.momentum.rsiState === 'oversold'
    : (entry.momentum.macdHistogram ?? 0) < 0 || entry.momentum.rsiState === 'overbought';
  factors.push({
    factor: 'Entry-timeframe confirmation',
    points: entryConfirms ? 5 : 0,
    max: 5,
    note: `${spec.entryTf}: MACD histogram ${entry.momentum.macdHistogram ?? 'n/a'}, RSI ${entry.momentum.rsi ?? 'n/a'}`,
  });

  if (stopCapped) {
    factors.push({
      factor: 'Stop quality',
      points: -12,
      max: 0,
      note: 'No structural level within reach — the stop is volatility-based and sits inside the noise band',
    });
  }
  if (forced && !htfAligned) {
    factors.push({
      factor: 'Counter-trend penalty',
      points: -15,
      max: 0,
      note: 'Direction was forced against the higher-timeframe trend',
    });
  }
  if (strategy === 'reversal') {
    factors.push({ factor: 'Counter-trend setup', points: -10, max: 0, note: 'Reversal setups fail more often than they work' });
  }

  const score = Math.max(0, Math.min(100, factors.reduce((sum, f) => sum + f.points, 0)));
  return { score, factors };
}

export const TRADE_SETUP_DESCRIPTION = `
Builds a complete, structure-based trade plan for any stock or crypto pair, on the horizon you ask for.

Returns the entry zone, the stop (placed beyond real structure, buffered by ATR), staged targets with
their R multiples, the reward:risk, position size for a given account and risk budget, and an auditable
confidence score broken into named factors.

Horizons — each uses a different set of timeframes, and a different stop width:
- **day** — 1h bias / 15m structure / 5m trigger. Minutes to hours.
- **swing** — 1d bias / 4h structure / 1h trigger. Days to weeks.
- **medium** — 1wk bias / 1d structure. Weeks to months.
- **long** — weekly structure, daily only to refine the price. Months to years.

The bias always comes from the higher timeframe and the trigger from the lower one. The tool will
answer "stand aside" when there is no edge — that is a real answer, not a failure.
`.trim();

export const tradeSetupTool = new DynamicStructuredTool({
  name: 'trade_setup',
  description:
    'Builds an actionable trade plan (entry zone, ATR-buffered structural stop, staged targets with R multiples, reward:risk, position sizing, scored confidence) for a stock or crypto pair on a day / swing / medium / long horizon. Multi-timeframe: higher timeframe sets the bias, lower one triggers. Says "stand aside" when there is no edge.',
  schema: TradeSetupSchema,
  func: async (input) => {
    const spec = HORIZONS[input.horizon as Horizon];
    const sources: string[] = [];

    try {
      const [trendSet, structureSet, entrySet] = await Promise.all([
        getCandles(input.symbol, spec.trendTf, spec.bars.trend, input.market as Market),
        getCandles(input.symbol, spec.structureTf, spec.bars.structure, input.market as Market),
        getCandles(input.symbol, spec.entryTf, spec.bars.entry, input.market as Market),
      ]);

      const resolved = structureSet.resolved;
      sources.push(
        resolved.market === 'crypto'
          ? `https://www.binance.com/trade/${resolved.symbol}`
          : `https://finance.yahoo.com/quote/${resolved.symbol}`,
      );

      const trendRead = analyzeTimeframe(trendSet.candles, trendSet.barsPerYear);
      const structureRead = analyzeTimeframe(structureSet.candles, structureSet.barsPerYear);
      const entryRead = analyzeTimeframe(entrySet.candles, entrySet.barsPerYear);

      if (!trendRead || !structureRead || !entryRead) {
        return formatToolResult(
          {
            error: `Not enough price history for ${resolved.symbol} to build a ${input.horizon} setup (need 30+ bars on ${spec.trendTf}/${spec.structureTf}/${spec.entryTf}, got ${trendSet.candles.length}/${structureSet.candles.length}/${entrySet.candles.length}).`,
            hint:
              resolved.market === 'equity' && (spec.entryTf === '5m' || spec.structureTf === '15m')
                ? 'Yahoo only serves ~55 days of intraday history, and none outside market hours for illiquid names. Try horizon="swing" instead.'
                : 'Try a longer horizon, or check the symbol.',
          },
          sources,
        );
      }

      // Bias: the higher timeframe decides unless the caller overrides it.
      const forced = input.direction !== 'auto';
      const bias: Direction = forced
        ? (input.direction as Direction)
        : trendRead.trend.direction === 'down'
          ? 'short'
          : 'long';

      const { strategy, timing, reason, directionOverride } = chooseStrategy(bias, structureRead, entryRead);
      // A reversal fades the trend, so it overrides the higher-timeframe bias.
      const side: Direction = directionOverride ?? bias;
      const lookback = PIVOT_LOOKBACK;

      let setup: TradeSetup;
      if (strategy === 'none') {
        setup = {
          direction: 'none',
          strategy: 'none',
          timing: 'stand-aside',
          trigger: 'None. Re-check when the higher-timeframe trend resolves or volatility compresses into a squeeze.',
          entry: null,
          stop: null,
          targets: [],
          riskReward: null,
          invalidation: 'n/a',
          confidence: { score: 0, factors: [{ factor: 'No setup', points: 0, max: 100, note: reason }] },
          warnings: [reason],
        };
      } else {
        const { entry, stop, targets, warnings } = buildLevels(
          side,
          strategy,
          structureRead,
          structureSet.candles,
          spec,
          lookback,
        );

        // The primary target is T2 when it exists: T1 is where partial profit
        // comes off, not where the trade is judged.
        const primary = targets[1] ?? targets[0] ?? null;
        const riskReward = primary ? primary.rMultiple : null;
        const confidence = scoreConfidence(
          side,
          strategy,
          trendRead,
          structureRead,
          entryRead,
          riskReward,
          spec,
          forced,
          stop?.structuralCapped ?? false,
        );

        if (riskReward !== null && riskReward < spec.minRiskReward) {
          warnings.push(
            `Reward:risk is ${riskReward}R, below the ${spec.minRiskReward}R minimum for a ${input.horizon} trade. The setup is real but the payoff does not justify it — wait for a better price.`,
          );
        }
        if (forced && bias !== (trendRead.trend.direction === 'down' ? 'short' : 'long')) {
          warnings.push(`Direction was forced ${bias} against a ${trendRead.trend.direction} higher timeframe.`);
        }

        const triggerText =
          timing === 'enter-now'
            ? `Price is already in the zone (${entry?.zoneLow}–${entry?.zoneHigh}). Enter on the next ${spec.entryTf} close that holds it.`
            : timing === 'wait-breakout'
              ? `Enter only on a ${spec.structureTf} close beyond ${entry?.ideal}, ideally on above-average volume. A wick through does not count.`
              : timing === 'wait-pullback'
                ? `Wait for price to trade back into ${entry?.zoneLow}–${entry?.zoneHigh}. Do not chase.`
                : `Wait for the ${spec.entryTf} chart to confirm the turn (MACD histogram flipping ${side === 'long' ? 'positive' : 'negative'}) before committing.`;

        setup = {
          direction: side,
          strategy,
          timing,
          trigger: triggerText,
          entry,
          stop,
          targets,
          riskReward,
          invalidation:
            stop && entry
              ? `${side === 'long' ? 'A close below' : 'A close above'} ${stop.price} on the ${spec.structureTf} chart. That level is ${stop.distanceAtr} ATR from the entry, so normal noise should not reach it — if it does, the read was wrong.`
              : 'n/a',
          confidence,
          warnings: [...warnings, reason],
        };
      }

      // --- Position sizing -------------------------------------------------
      let sizing: Record<string, unknown> | null = null;
      if (input.accountSize && setup.entry && setup.stop) {
        const perUnitRisk = Math.abs(setup.entry.ideal - setup.stop.price);
        const riskAmount = (input.accountSize * input.riskPercent) / 100;
        const units = perUnitRisk > 0 ? riskAmount / perUnitRisk : 0;
        const notional = units * setup.entry.ideal;
        const portfolioPercent = (notional / input.accountSize) * 100;
        sizing = {
          riskAmount: round(riskAmount, 2),
          riskPercent: input.riskPercent,
          perUnitRisk: round(perUnitRisk, 4),
          units: round(units, resolved.market === 'crypto' ? 6 : 2),
          notional: round(notional, 2),
          portfolioPercent: round(portfolioPercent, 1),
          note:
            portfolioPercent > 100
              ? 'This position needs more than the whole account — it requires leverage. Either widen the risk budget or accept a smaller size than the risk model suggests.'
              : portfolioPercent > 25
                ? 'Over a quarter of the account in one position. The stop is tight enough to justify it arithmetically, but the concentration risk is real.'
                : 'Size fits the risk budget without concentration.',
        };
      }

      return formatToolResult(
        {
          symbol: resolved.symbol,
          market: resolved.market,
          horizon: input.horizon,
          horizonSpec: {
            label: spec.label,
            timeframes: `${spec.trendTf} bias / ${spec.structureTf} structure / ${spec.entryTf} trigger`,
            holdingPeriod: spec.holdingPeriod,
            minRiskReward: spec.minRiskReward,
            doctrine: HORIZON_DOCTRINE[input.horizon as Horizon],
          },
          price: structureRead.price,
          asOf: structureRead.lastDate,
          setup,
          sizing,
          // Attached to every recommendation on purpose: a confidence score is
          // meaningless unless what it scores has a known hit rate. Where the
          // backtest found no edge, the tool says so instead of letting a
          // number imply one.
          calibration: calibrationFor(input.horizon as Horizon, setup.strategy),
          context: {
            trend: {
              timeframe: spec.trendTf,
              direction: trendRead.trend.direction,
              adx: trendRead.trend.strength,
              structure: trendRead.trend.structure,
              maRegime: trendRead.trend.maRegime,
            },
            structure: {
              timeframe: spec.structureTf,
              regime: structureRead.regime,
              rsi: structureRead.momentum.rsi,
              atrPercent: structureRead.volatility.atrPercent,
              rangePosition: structureRead.levels.rangePosition,
              support: structureRead.levels.support.map((l) => l.price),
              resistance: structureRead.levels.resistance.map((l) => l.price),
              signals: structureRead.signals,
            },
            entryTimeframe: {
              timeframe: spec.entryTf,
              rsi: entryRead.momentum.rsi,
              macdHistogram: entryRead.momentum.macdHistogram,
              signals: entryRead.signals.slice(0, 3),
            },
          },
          disclaimer: 'Structure-derived plan, not investment advice. Position sizing assumes the stop is honoured.',
        },
        sources,
      );
    } catch (error) {
      return formatToolResult(
        { error: `Trade setup failed for ${input.symbol}: ${error instanceof Error ? error.message : String(error)}` },
        sources,
      );
    }
  },
});
