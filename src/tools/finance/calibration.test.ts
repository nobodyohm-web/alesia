import { describe, test, expect } from 'bun:test';
import { CALIBRATION, ENGINE_SIGNATURE, calibrationFor, DAY_BREAKEVEN_COST_BP } from './calibration.js';
import { currentSignature, frozenSeries } from './backtest/signature.js';
import { backtestSymbol, computeMetrics } from './backtest/harness.js';
import { DEFAULT_THRESHOLDS } from './thresholds.js';
import type { Horizon } from './horizons.js';

describe('calibration drift guard', () => {
  test('the engine still behaves as it did when the numbers were measured', () => {
    // WHEN THIS FAILS, the engine's decisions have changed. That is not a
    // reason to update this expectation on its own: re-run
    //   bun run src/tools/finance/backtest/run.ts baseline
    //   bun run src/tools/finance/backtest/run.ts day
    // update CALIBRATION with the new figures and measuredOn date, and only
    // then refresh ENGINE_SIGNATURE. Bumping the signature alone converts an
    // honest measurement into a stale one that still looks authoritative.
    expect(currentSignature()).toEqual(ENGINE_SIGNATURE);
  });

  test('the guard actually detects a behavioural change', () => {
    // Proof the assertion above is not vacuous. A guard nobody has seen fail is
    // a guard nobody knows works — the same discipline the frontmatter RCE test
    // uses, where the payload is first run against the unpatched parser.
    const candles = frozenSeries(600, 11, 100);
    const base = backtestSymbol('FIXTURE', { entry: candles, structure: candles, trend: candles }, 'swing', {
      thresholds: DEFAULT_THRESHOLDS,
      costFraction: 0.001,
      maxHoldBars: 40,
      windowBars: 260,
      step: 1,
    });
    const altered = backtestSymbol('FIXTURE', { entry: candles, structure: candles, trend: candles }, 'swing', {
      thresholds: { ...DEFAULT_THRESHOLDS, adxSetupTrending: 40 },
      costFraction: 0.001,
      maxHoldBars: 40,
      windowBars: 260,
      step: 1,
    });
    expect(base.length).toBeGreaterThan(0);
    expect(computeMetrics(altered).trades).not.toBe(computeMetrics(base).trades);
  });

  test('the fixture is deterministic across calls', () => {
    expect(JSON.stringify(frozenSeries(50, 11, 100))).toBe(JSON.stringify(frozenSeries(50, 11, 100)));
  });
});

describe('calibration records', () => {
  test('every record carries a sample size and an interval that brackets it', () => {
    for (const entry of Object.values(CALIBRATION)) {
      if (!entry) continue;
      for (const record of [entry.overall, ...Object.values(entry.byStrategy)]) {
        expect(record.n).toBeGreaterThan(0);
        expect(record.ci95[0]).toBeLessThanOrEqual(record.expectancyR);
        expect(record.ci95[1]).toBeGreaterThanOrEqual(record.expectancyR);
        expect(record.basis.length).toBeGreaterThan(20);
      }
    }
  });

  test('a horizon with no measurement says so instead of implying one', () => {
    // `day`, `swing`, `medium` and `long` are all measured today. If a future
    // horizon is added without a backtest, the verdict must not fabricate one.
    const verdict = calibrationFor('reversal-horizon' as Horizon, 'breakout').verdict;
    expect(verdict).toContain('No backtest exists');
  });

  test('the day break-even cost is below every realistic fee tier', () => {
    // The whole point of that horizon's refusal: 1.33bp round trip against a
    // cheapest realistic 8bp.
    expect(DAY_BREAKEVEN_COST_BP).toBeLessThan(8);
  });
});
