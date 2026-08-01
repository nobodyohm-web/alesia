/**
 * Walk-forward backtest harness — leak-safe by construction.
 *
 * THE ONE RULE: never index backwards into a full series. Every read goes
 * through `windowAt()`, which hands the engine a slice ending at the bar being
 * decided on. That single discipline neutralises the two look-ahead hazards in
 * the indicator layer:
 *
 *   - `supportResistance()` takes its clustering tolerance from end-of-series
 *     ATR. Sliced, "end of series" IS the decision bar, so the tolerance is the
 *     volatility actually known at that moment.
 *   - `swingPoints()` only returns pivots with `lookback` bars on both sides,
 *     so a sliced call structurally cannot return a pivot that had not yet
 *     printed. This is not a workaround — it mirrors live behaviour, where the
 *     structural stop is genuinely anchored on a pivot confirmed some bars ago.
 *
 * The window is a FIXED size, matching what the live tools request. A growing
 * window would make the same bar read differently depending on how much history
 * preceded it, which is both O(n^2) and a different engine than the one that
 * runs in production.
 *
 * Fill model, deliberately pessimistic:
 *   - Decide on bar t using data through t's close; enter no earlier than t+1.
 *     Deciding and filling on the same close is the most common way a backtest
 *     invents money that was never available.
 *   - When a bar touches both the stop and a target, the STOP wins. Intrabar
 *     order is unknowable, and assuming the favourable one is how a losing
 *     system tests profitable.
 *   - Fees and slippage are subtracted in R, not ignored.
 */
import { analyzeTimeframe } from '../market-read.js';
import { chooseStrategy, buildLevels, type Direction, type Strategy } from '../trade-setup.js';
import { HORIZONS, type Horizon } from '../horizons.js';
import { DEFAULT_THRESHOLDS, type Thresholds } from '../thresholds.js';
import { PIVOT_LOOKBACK, macd, round, type Candle } from '../indicators.js';

export interface SimTrade {
  symbol: string;
  horizon: Horizon;
  direction: Direction;
  strategy: Strategy;
  entryDate: string;
  entryPrice: number;
  stop: number;
  target: number;
  exitDate: string;
  exitPrice: number;
  /** Result in R, net of costs. The only unit comparable across instruments. */
  resultR: number;
  outcome: 'target' | 'stop' | 'timeout';
  barsHeld: number;
}

export interface BacktestOptions {
  thresholds?: Thresholds;
  /** Bars of history handed to the engine at each step. Mirrors live usage. */
  windowBars?: number;
  /** Bars a pending order stays live before it is abandoned. */
  pendingBars?: number;
  /** Bars after which an open position is closed at market. */
  maxHoldBars?: number;
  /** Round-trip cost as a fraction of notional (0.002 = 20bp). */
  costFraction?: number;
  /** Only simulate every Nth bar, to keep long series tractable. */
  step?: number;
}

/** Fixed-size window ending at `index`, inclusive. */
function windowAt(candles: Candle[], index: number, size: number): Candle[] {
  return candles.slice(Math.max(0, index + 1 - size), index + 1);
}

/**
 * Align a higher timeframe to a lower one without scanning on every bar.
 *
 * Returns, for each index of `base`, the count of `higher` bars that had
 * already CLOSED by then. A higher-timeframe bar is only usable once the base
 * series has moved past it — using the bar that contains the current moment
 * would leak its own high, low and close.
 */
function buildAlignment(base: Candle[], higher: Candle[]): number[] {
  const out = new Array<number>(base.length).fill(0);
  let h = 0;
  for (let i = 0; i < base.length; i++) {
    const now = base[i].date;
    while (h < higher.length && higher[h].date < now) h++;
    // `h` is the first higher bar at or after `now`, so bars [0, h) have opened
    // strictly before. The last of those may still be forming, so drop it.
    out[i] = Math.max(0, h - 1);
  }
  return out;
}

type OrderKind = 'market' | 'limit' | 'stop';

/**
 * Would this bar have filled the order?
 *
 * A limit buy fills when price trades down to it, a stop buy when price trades
 * up through it, and a market order fills at the next open.
 */
export function fillPriceOn(bar: Candle, kind: OrderKind, price: number, isLong: boolean): number | null {
  if (kind === 'market') return bar.open;
  if (kind === 'limit') {
    if (isLong) return bar.low <= price ? Math.min(price, bar.open) : null;
    return bar.high >= price ? Math.max(price, bar.open) : null;
  }
  if (isLong) return bar.high >= price ? Math.max(price, bar.open) : null;
  return bar.low <= price ? Math.min(price, bar.open) : null;
}

/**
 * Run the real engine bar by bar over one symbol on one horizon.
 *
 * `entry`, `structure` and `trend` are the three series the live tool fetches.
 * They may be the same array when a horizon uses one timeframe twice.
 */
export function backtestSymbol(
  symbol: string,
  series: { entry: Candle[]; structure: Candle[]; trend: Candle[] },
  horizon: Horizon,
  opts: BacktestOptions = {},
): SimTrade[] {
  const spec = HORIZONS[horizon];
  const thresholds = opts.thresholds ?? DEFAULT_THRESHOLDS;
  const windowBars = opts.windowBars ?? 260;
  const pendingBars = opts.pendingBars ?? 5;
  const maxHoldBars = opts.maxHoldBars ?? 60;
  const cost = opts.costFraction ?? 0.001;
  const step = opts.step ?? 1;

  const { entry, structure, trend } = series;
  const toStructure = buildAlignment(entry, structure);
  const toTrend = buildAlignment(entry, trend);

  // Confirmation signal for reversal setups, precomputed once.
  //
  // Safe to compute on the whole series and index at bar j, because MACD is
  // STRICTLY CAUSAL: its value at j depends only on closes[0..j]. That is not
  // true of everything in the indicator layer — supportResistance draws its
  // clustering tolerance from end-of-series ATR, and swingPoints needs bars to
  // the RIGHT of a pivot — which is exactly why those two go through windowAt()
  // and this one does not.
  const confirmation = macd(entry.map((c) => c.close)).histogram;

  const trades: SimTrade[] = [];
  // Minimum history for analyzeTimeframe to return anything at all.
  const warmup = 60;
  let resumeAt = -1; // index before which no new decision may be taken

  for (let i = warmup; i < entry.length - 2; i += step) {
    if (i < resumeAt) continue;

    // --- Decide, using only data through this bar's close -----------------
    const structureCount = toStructure[i];
    const trendCount = toTrend[i];
    if (structureCount < warmup || trendCount < warmup) continue;

    const entryRead = analyzeTimeframe(windowAt(entry, i, windowBars), 252, thresholds);
    const structureRead = analyzeTimeframe(
      windowAt(structure, structureCount - 1, windowBars), 252, thresholds,
    );
    const trendRead = analyzeTimeframe(windowAt(trend, trendCount - 1, windowBars), 252, thresholds);
    if (!entryRead || !structureRead || !trendRead) continue;

    const bias: Direction = trendRead.trend.direction === 'down' ? 'short' : 'long';
    const { strategy, timing, directionOverride } = chooseStrategy(bias, structureRead, entryRead, thresholds);
    if (strategy === 'none' || timing === 'stand-aside') continue;
    // A reversal fades the trend and carries its own direction.
    const side: Direction = directionOverride ?? bias;

    const structureWindow = windowAt(structure, structureCount - 1, windowBars);
    const { entry: zone, stop, targets } = buildLevels(
      side, strategy, structureRead, structureWindow, spec, PIVOT_LOOKBACK,
    );
    if (!zone || !stop || targets.length === 0) continue;

    const target = (targets[1] ?? targets[0]).price;
    const rr = Math.abs(target - zone.ideal) / Math.abs(zone.ideal - stop.price);
    if (!Number.isFinite(rr) || rr < spec.minRiskReward) continue;

    const isLong = side === 'long';

    // A reversal is counter-trend by construction, so the tool refuses to
    // commit until the entry timeframe turns. Modelling that faithfully means
    // waiting for the MACD histogram to FLIP into the trade's direction, then
    // paying market on the next bar — not assuming a fill at the level.
    let firstBar = i + 1;
    if (timing === 'wait-confirmation') {
      let flipped = -1;
      for (let j = i + 1; j <= Math.min(i + pendingBars, entry.length - 2); j++) {
        const now = confirmation[j];
        const prev = confirmation[j - 1];
        if (now === null || prev === null) continue;
        if (isLong ? now > 0 && prev <= 0 : now < 0 && prev >= 0) {
          flipped = j;
          break;
        }
      }
      if (flipped === -1) continue; // never confirmed — the setup expires unfilled
      firstBar = flipped + 1;
    }

    const kind: OrderKind =
      timing === 'enter-now' || timing === 'wait-confirmation'
        ? 'market'
        : timing === 'wait-breakout'
          ? 'stop'
          : 'limit';

    // Scan for the fill BAR BY BAR, never by `step`. Stepping the fill scan as
    // well would give a limit order fewer chances to fill than it really had,
    // quietly under-sampling pullback entries and over-weighting market ones —
    // which moved measured expectancy by 0.26R purely as an artefact.
    const deadline = Math.min(firstBar + pendingBars, entry.length - 2);
    for (let j = firstBar; j <= deadline; j++) {
      const fill = fillPriceOn(entry[j], kind, zone.ideal, isLong);
      if (fill === null) continue;

      // A bar that gaps clean through the entry zone has already violated the
      // setup's premise — the level did not hold. Taking the fill anyway
      // produced entries BELOW their own stop, whose risk unit collapsed to a
      // rounding error and whose cost-in-R exploded, which is why stopped
      // trades were averaging -1.26R instead of -1.05R.
      const outsideZone = fill < zone.zoneLow * 0.999 || fill > zone.zoneHigh * 1.001;
      const beyondStop = isLong ? fill <= stop.price : fill >= stop.price;
      if (outsideZone || beyondStop) break;

      const trade = simulateExit(
        symbol, horizon,
        { direction: side, strategy, stop: stop.price, target },
        fill, entry, j, maxHoldBars, cost,
      );
      if (trade) {
        trades.push(trade);
        resumeAt = j + trade.barsHeld + 1;
      }
      break;
    }
  }

  return trades;
}

/** Walk forward from the fill bar until stop, target or timeout. */
function simulateExit(
  symbol: string,
  horizon: Horizon,
  order: { direction: Direction; strategy: Strategy; stop: number; target: number },
  fillPrice: number,
  candles: Candle[],
  fillIndex: number,
  maxHoldBars: number,
  cost: number,
): SimTrade | null {
  const isLong = order.direction === 'long';
  const risk = Math.abs(fillPrice - order.stop);
  if (risk <= 0) return null;

  const finish = (exitIndex: number, exitPrice: number, outcome: SimTrade['outcome']): SimTrade => {
    const move = isLong ? exitPrice - fillPrice : fillPrice - exitPrice;
    // Costs are charged on both legs, expressed in the trade's own risk unit.
    const costR = (cost * fillPrice) / risk;
    return {
      symbol, horizon,
      direction: order.direction,
      strategy: order.strategy,
      entryDate: candles[fillIndex].date,
      entryPrice: round(fillPrice, 6),
      stop: round(order.stop, 6),
      target: round(order.target, 6),
      exitDate: candles[exitIndex].date,
      exitPrice: round(exitPrice, 6),
      resultR: round(move / risk - costR, 4),
      outcome,
      barsHeld: exitIndex - fillIndex,
    };
  };

  const lastIndex = Math.min(fillIndex + maxHoldBars, candles.length - 1);
  for (let j = fillIndex + 1; j <= lastIndex; j++) {
    const bar = candles[j];
    const stopHit = isLong ? bar.low <= order.stop : bar.high >= order.stop;
    const targetHit = isLong ? bar.high >= order.target : bar.low <= order.target;
    // Stop wins ties: intrabar sequence is unknowable, and assuming the
    // favourable ordering is how a losing system backtests profitable.
    if (stopHit) return finish(j, order.stop, 'stop');
    if (targetHit) return finish(j, order.target, 'target');
  }
  return finish(lastIndex, candles[lastIndex].close, 'timeout');
}

export interface Metrics {
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgWinR: number | null;
  avgLossR: number | null;
  /** Mean R per trade. The number that decides whether a system is worth running. */
  expectancyR: number | null;
  totalR: number;
  maxDrawdownR: number | null;
  /** 95% bootstrap interval on expectancy, so a lucky sample is visible as such. */
  expectancyCI: [number, number] | null;
  byOutcome: Record<string, number>;
}

/**
 * Deterministic bootstrap: resamples with a fixed linear congruential generator
 * rather than Math.random, so a calibration run is reproducible. An expectancy
 * without an interval is a point estimate pretending to be a measurement.
 */
function bootstrapCI(values: number[], iterations = 1000): [number, number] | null {
  if (values.length < 10) return null;
  let seed = 42;
  const next = (): number => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const means: number[] = [];
  for (let b = 0; b < iterations; b++) {
    let sum = 0;
    for (let k = 0; k < values.length; k++) sum += values[Math.floor(next() * values.length)];
    means.push(sum / values.length);
  }
  means.sort((a, b) => a - b);
  return [round(means[Math.floor(iterations * 0.025)], 4), round(means[Math.floor(iterations * 0.975)], 4)];
}

export function computeMetrics(trades: SimTrade[]): Metrics {
  const rs = trades.map((t) => t.resultR);
  const wins = rs.filter((r) => r > 0);
  const losses = rs.filter((r) => r < 0);
  const mean = (xs: number[]): number | null =>
    xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length, 4) : null;

  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  for (const r of rs) {
    equity += r;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }

  const byOutcome: Record<string, number> = {};
  for (const t of trades) byOutcome[t.outcome] = (byOutcome[t.outcome] ?? 0) + 1;

  return {
    trades: rs.length,
    wins: wins.length,
    losses: losses.length,
    winRate: rs.length ? round((wins.length / rs.length) * 100, 1) : null,
    avgWinR: mean(wins),
    avgLossR: mean(losses),
    expectancyR: mean(rs),
    totalR: round(rs.reduce((a, b) => a + b, 0), 2),
    maxDrawdownR: rs.length ? round(maxDd, 2) : null,
    expectancyCI: bootstrapCI(rs),
    byOutcome,
  };
}
