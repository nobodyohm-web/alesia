/**
 * Measured calibration — what the engine actually did, not what it hopes to do.
 *
 * Produced by `bun run src/tools/finance/backtest/run.ts baseline` on
 * 2026-08-01, against the walk-forward harness in ./backtest. Every figure is
 * net of costs (20bp round trip on crypto, 4-6bp on equities), uses a stop-wins
 * tie rule, and fills no earlier than the bar after the decision.
 *
 * The point of attaching this to every recommendation is calibration in the
 * forecasting sense: a confidence score means nothing unless the thing it
 * scores has a known hit rate. Where the measurement says "no demonstrated
 * edge", the tool must say so rather than let a 70/100 imply one.
 *
 * HONEST STATUS: the headline result is negative. On the horizon with the best
 * data — crypto swing, 3,806 trades, Binance history back to 2017, no
 * survivorship bias — expectancy is +0.007R with a confidence interval tight
 * around zero. A threshold sweep found NO value of any swept parameter that
 * produced positive out-of-sample expectancy: train ran +0.05 to +0.075R and
 * test ran -0.08 to -0.10R across every setting. That is not a tuning problem,
 * and pretending otherwise by shipping the best in-sample value would have
 * meant shipping a confidently wrong system.
 */
import type { Horizon } from './horizons.js';

export interface CalibrationRecord {
  /** Trades in the measured sample. */
  n: number;
  /** Mean R per trade, net of costs. */
  expectancyR: number;
  /** 95% bootstrap interval. If it spans zero, no edge was demonstrated. */
  ci95: [number, number];
  winRate: number;
  /** What the measurement rests on, and what it cannot support. */
  basis: string;
}

const NO_EDGE = 'Confidence interval spans zero — no edge demonstrated on this sample.';

export const CALIBRATION: Partial<
  Record<Horizon, { overall: CalibrationRecord; byStrategy: Record<string, CalibrationRecord> }>
> = {
  swing: {
    overall: {
      n: 3806,
      expectancyR: 0.0073,
      ci95: [-0.034, 0.051],
      winRate: 40.9,
      basis:
        'Crypto only (8 Binance pairs, 2017-2026, hourly). The most reliable sample here: largest n, no survivorship bias. ' +
        NO_EDGE,
    },
    byStrategy: {
      'trend-pullback': {
        n: 2592, expectancyR: 0.0, ci95: [-0.05, 0.046], winRate: 41.0,
        basis: 'Exactly zero over 2,592 trades. This is the engine\'s most common setup and it has no measured edge.',
      },
      breakout: {
        n: 530, expectancyR: 0.1097, ci95: [0.004, 0.22], winRate: 44.0,
        basis: 'Marginally significant — the interval clears zero by 0.004R, which is not a result to size up on.',
      },
      'range-reversion': {
        n: 684, expectancyR: -0.0444, ci95: [-0.144, 0.064], winRate: 37.7,
        basis: `Negative point estimate. ${NO_EDGE} An earlier harness reported this as significantly loss-making; that was an artefact of a gap-fill bug.`,
      },
    },
  },
  medium: {
    overall: {
      n: 1088,
      expectancyR: 0.155,
      ci95: [0.065, 0.261],
      winRate: 41.3,
      basis:
        'Mostly equities, whose sample is a CEILING: Yahoo serves only instruments that still trade, so every company that went to zero is absent. Treat as optimistic.',
    },
    byStrategy: {
      'trend-pullback': {
        n: 789, expectancyR: 0.1444, ci95: [0.043, 0.248], winRate: 40.7,
        basis: 'Survivorship-biased ceiling.',
      },
      breakout: {
        n: 225, expectancyR: 0.1759, ci95: [-0.012, 0.349], winRate: 42.2,
        basis: NO_EDGE,
      },
    },
  },
  long: {
    overall: {
      n: 470,
      expectancyR: 0.128,
      ci95: [0.073, 0.183],
      winRate: 55.7,
      basis:
        'Confounded, not an edge: 429 of 470 trades ended on the holding limit rather than at a stop or target, so this largely measures the equity risk premium over a 52-week hold. Survivorship-biased on top.',
    },
    byStrategy: {},
  },
};

/**
 * The honest sentence to attach to a setup on this horizon.
 *
 * Returned verbatim in the tool payload so the model cannot round an ambiguous
 * measurement up into a claim.
 */
export function calibrationFor(horizon: Horizon, strategy: string): {
  measured: CalibrationRecord | null;
  horizonMeasured: CalibrationRecord | null;
  verdict: string;
} {
  const entry = CALIBRATION[horizon];
  if (!entry) {
    return {
      measured: null,
      horizonMeasured: null,
      verdict: `No backtest exists for the ${horizon} horizon — its thresholds are conventions, and the confidence score is descriptive only.`,
    };
  }

  const measured = entry.byStrategy[strategy] ?? null;
  const record = measured ?? entry.overall;
  const spansZero = record.ci95[0] <= 0 && record.ci95[1] >= 0;

  const verdict = spansZero
    ? `Measured expectancy ${record.expectancyR >= 0 ? '+' : ''}${record.expectancyR}R over ${record.n} backtested trades, 95% CI [${record.ci95[0]}, ${record.ci95[1]}] — spans zero, so NO edge has been demonstrated for this setup. Treat the confidence score as a description of conditions, not as a probability of profit.`
    : `Measured expectancy ${record.expectancyR >= 0 ? '+' : ''}${record.expectancyR}R over ${record.n} backtested trades, 95% CI [${record.ci95[0]}, ${record.ci95[1]}]. ${record.basis}`;

  return { measured, horizonMeasured: entry.overall, verdict };
}
