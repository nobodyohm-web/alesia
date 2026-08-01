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

/**
 * Behavioural fingerprint of the decision engine at the moment CALIBRATION was
 * measured, captured on a frozen synthetic fixture (see calibration.test.ts).
 *
 * A source-hash would fail on a renamed variable and be switched off within a
 * week; this only moves when the engine's DECISIONS move. Its job is to make
 * stale calibration numbers impossible to ship silently — the failure mode that
 * matters, because a wrong expectancy quoted with a confidence interval looks
 * more rigorous than no expectancy at all.
 */
export const ENGINE_SIGNATURE = {
  trades: 71,
  expectancyR: 0.3068,
  winRate: 56.3,
  byStrategy: { 'trend-pullback': 29, breakout: 41, 'range-reversion': 1 } as Record<string, number>,
};

/** When CALIBRATION was last measured against the engine ENGINE_SIGNATURE pins. */
export const MEASURED_ON = '2026-08-01';

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

/**
 * Round-trip cost, as a fraction of notional, at which the day horizon breaks
 * even. Derived from the measured cost sensitivity, which is exactly linear:
 *
 *   gross  +0.0257R      8bp -> -0.1292R      15bp -> -0.2648R      20bp -> -0.3616R
 *
 * That gives cost_in_R = 193.6 x costFraction (predicted -0.265 and -0.361 at
 * 15 and 20bp against -0.2648 and -0.3616 observed), so the gross edge of
 * 0.0257R is exhausted at a costFraction of 0.0257 / 193.6.
 */
export const DAY_BREAKEVEN_COST_BP = 1.33;

export const CALIBRATION: Partial<
  Record<Horizon, { overall: CalibrationRecord; byStrategy: Record<string, CalibrationRecord> }>
> = {
  day: {
    overall: {
      n: 13263,
      // Reported GROSS on purpose: net of any real fee it is decisively
      // negative, and the gross figure is what makes the diagnosis precise —
      // there IS a signal, it is simply far too small to pay for the trip.
      expectancyR: 0.0257,
      ci95: [0.005, 0.048],
      winRate: 42.9,
      basis:
        'GROSS of costs, 4 Binance pairs, 2 years of 5-minute bars. The gross edge is statistically real, ' +
        `but it dies at ${DAY_BREAKEVEN_COST_BP}bp round trip — roughly 0.66bp per side, below any retail fee anywhere. ` +
        'Net: -0.129R at 8bp (futures VIP), -0.265R at 15bp, -0.362R at 20bp (spot taker), every one of them ' +
        'with a confidence interval entirely below zero. No strategy escapes: trend-pullback -0.245R, ' +
        'breakout -0.184R, range-reversion -0.327R at 15bp. ' +
        'Caveat: the 5m sample spans only 2 years, so no out-of-sample split was possible on this horizon.',
    },
    byStrategy: {
      'trend-pullback': {
        n: 7412, expectancyR: -0.2454, ci95: [-0.278, -0.212], winRate: 38.9,
        basis: 'Net of 15bp. Significantly loss-making.',
      },
      breakout: {
        n: 1537, expectancyR: -0.1843, ci95: [-0.233, -0.132], winRate: 38.4,
        basis: 'Net of 15bp. The least bad, still significantly loss-making.',
      },
      'range-reversion': {
        n: 4314, expectancyR: -0.3267, ci95: [-0.37, -0.285], winRate: 35.1,
        basis: 'Net of 15bp. The worst of the three.',
      },
    },
  },
  swing: {
    overall: {
      n: 3821,
      expectancyR: 0.0062,
      ci95: [-0.033, 0.046],
      winRate: 40.9,
      basis:
        'Crypto (8 Binance pairs, 2017-2026, hourly) — the most reliable sample here: largest n, no survivorship bias. ' +
        'Equities measured separately and SEPARATELY UNDERPOWERED: only 187 trades, because Yahoo caps hourly ' +
        'history at ~400 days, giving expectancy -0.052R with CI [-0.240, 0.142] — an interval too wide to ' +
        'distinguish a good system from a bad one. ' +
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
      reversal: {
        n: 5, expectancyR: -1.0457, ci95: [-1.05, -1.04], winRate: 0,
        basis:
          'FIVE trades, all stopped out. Not a measurement — a count. This setup was unreachable dead code until ' +
          'it was fixed (it demanded a long bias in an oversold market, conditions that exclude each other by ' +
          'construction; a backtest found the condition true 0 times in 3,011 bars). Now that it fires, it fires ' +
          'so rarely that no sample worth the name exists. Treat any reversal setup as untested.',
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

  // The day horizon is not "unproven", it is disproven, and the warning has to
  // lead rather than sit under a plausible-looking entry price.
  if (horizon === 'day') {
    const day = entry.overall;
    return {
      measured: entry.byStrategy[strategy] ?? null,
      horizonMeasured: day,
      verdict:
        `DO NOT TRADE THIS AS SHOWN. Measured over ${day.n} backtested day trades: the setup logic has a real but ` +
        `tiny gross edge (+${day.expectancyR}R), which is exhausted by a round-trip cost of just ` +
        `${DAY_BREAKEVEN_COST_BP}bp. Net of the cheapest realistic fee (8bp) it loses 0.129R per trade, and at a ` +
        `spot taker fee (20bp) it loses 0.362R — every tier with a confidence interval entirely below zero. ` +
        `Costs are roughly six times the edge. Treat this output as market structure to read, never as a trade to take, ` +
        `unless you execute at maker fees near zero AND have re-measured it yourself.`,
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
