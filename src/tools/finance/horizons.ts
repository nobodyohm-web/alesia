/**
 * Trading horizons — the four clocks Alesia reasons on.
 *
 * A horizon is not a preference, it is a complete specification: which
 * timeframe sets the bias, which one defines the setup, which one triggers the
 * entry, how wide the stop has to be to survive normal noise, and how long the
 * position is expected to live. Mixing them is the classic way to lose money:
 * taking a day-trade entry with a long-term stop, or a long-term thesis with a
 * day-trade stop, are both incoherent.
 *
 * The rule enforced everywhere downstream: the bias comes from the HIGHER
 * timeframe, the entry comes from the LOWER one. Fighting the higher timeframe
 * is the single most expensive habit in discretionary trading.
 */
import type { Timeframe } from './candles.js';

export type Horizon = 'day' | 'swing' | 'medium' | 'long';

export interface HorizonSpec {
  /** Sets the directional bias. Trades against it are downgraded, not offered. */
  trendTf: Timeframe;
  /** Where structure, levels and the setup are read. */
  structureTf: Timeframe;
  /** Where the trigger fires. */
  entryTf: Timeframe;
  /** Bars to fetch per timeframe — enough for EMA200 where it is meaningful. */
  bars: { trend: number; structure: number; entry: number };
  /** ATR multiple for the stop buffer beyond the structural level. */
  stopAtrMultiple: number;
  /**
   * Hard ceilings on stop distance, in ATR and in percent of price.
   *
   * The nearest structural level can be absurdly far — on a weekly chart the
   * next resistance above may sit 50% away. A stop there is not risk
   * management, it is a position with no stop wearing one as a costume, and
   * it silently destroys the R arithmetic that every target depends on.
   * When structure is further than this, the stop reverts to pure volatility
   * and the setup is downgraded to say so.
   */
  maxStopAtr: number;
  maxStopPercent: number;
  /** Typical holding period, stated so the user can size expectations. */
  holdingPeriod: string;
  /** Minimum reward:risk worth taking at this horizon. */
  minRiskReward: number;
  label: string;
  description: string;
}

export const HORIZONS: Record<Horizon, HorizonSpec> = {
  day: {
    trendTf: '1h',
    structureTf: '15m',
    entryTf: '5m',
    bars: { trend: 200, structure: 200, entry: 200 },
    // Intraday noise is proportionally larger; a tight stop guarantees being
    // shaken out before the move even starts.
    stopAtrMultiple: 0.75,
    maxStopAtr: 3,
    maxStopPercent: 3,
    holdingPeriod: 'minutes to hours, flat by the close',
    // Costs and spread eat a bigger share of a small move, so the bar is higher.
    minRiskReward: 1.5,
    label: 'Day trading',
    description: 'Intraday only. 1h sets the bias, 15m the structure, 5m the trigger. No overnight risk.',
  },
  swing: {
    trendTf: '1d',
    structureTf: '4h',
    entryTf: '1h',
    bars: { trend: 250, structure: 250, entry: 200 },
    stopAtrMultiple: 1.0,
    maxStopAtr: 3.5,
    maxStopPercent: 12,
    holdingPeriod: '2 to 15 sessions',
    minRiskReward: 2.0,
    label: 'Swing trading',
    description: 'Days to weeks. Daily sets the bias, 4h the structure, 1h the trigger. Carries overnight and gap risk.',
  },
  medium: {
    trendTf: '1wk',
    structureTf: '1d',
    entryTf: '1d',
    bars: { trend: 260, structure: 400, entry: 400 },
    // Wide enough to sit through an earnings reaction without being stopped.
    stopAtrMultiple: 1.5,
    maxStopAtr: 4,
    maxStopPercent: 25,
    holdingPeriod: 'several weeks to several months',
    minRiskReward: 2.5,
    label: 'Position / medium term',
    description: 'Weeks to months. Weekly sets the bias, daily the structure and the trigger. Fundamentals start to dominate.',
  },
  long: {
    trendTf: '1wk',
    structureTf: '1wk',
    entryTf: '1d',
    bars: { trend: 400, structure: 400, entry: 400 },
    stopAtrMultiple: 2.5,
    maxStopAtr: 5,
    maxStopPercent: 40,
    holdingPeriod: 'months to years',
    minRiskReward: 3.0,
    label: 'Long term',
    description:
      'Months to years. Weekly structure only; the daily chart is used purely to improve the entry price. Valuation drives the decision, technicals only refine when to commit capital.',
  },
};

/**
 * At the long end, technicals are a timing aid rather than a thesis. Stating
 * this explicitly keeps the agent from dressing up a weekly RSI reading as a
 * reason to buy a business it has not valued.
 */
export const HORIZON_DOCTRINE: Record<Horizon, string> = {
  day: 'Pure technicals and flow. Fundamentals are irrelevant at this horizon except as a scheduled-event risk (earnings, FOMC, CPI) to avoid holding through.',
  swing: 'Technicals lead, catalysts matter. Check the earnings date before entering — an earnings gap can jump straight through a stop.',
  medium: 'Technicals time the entry, fundamentals justify it. A medium-term position in a deteriorating business is a slow loss dressed as patience.',
  long: 'Fundamentals decide, technicals only time. Never take a long-term position on a chart signal alone: valuation and business quality come first, and the chart merely improves the price paid.',
};
