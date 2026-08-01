/**
 * Behavioural signature of the decision engine.
 *
 * Lives outside the test file so it can be recomputed by a script when the
 * engine legitimately changes and the calibration is re-measured:
 *
 *   bun run src/tools/finance/backtest/signature.ts
 */
import { backtestSymbol } from './harness.js';
import { DEFAULT_THRESHOLDS } from '../thresholds.js';
import type { Candle } from '../indicators.js';
import type { Horizon } from '../horizons.js';

/**
 * FROZEN FIXTURE — do not edit.
 *
 * The numbers in calibration.ts were measured against a specific state of the
 * decision engine. If the engine changes and those numbers stay, the tool goes
 * on quoting an expectancy for behaviour that no longer exists — which is worse
 * than quoting none at all, because it looks rigorous.
 *
 * This series is the tripwire. Its exact values do not matter; what matters is
 * that it is deterministic and never changes, so any drift in the signature
 * below is drift in the ENGINE, not in the fixture. Editing this generator
 * would silently disarm the guard.
 */
export function frozenSeries(n: number, seed: number, start: number): Candle[] {
  let s = seed;
  const next = (): number => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const out: Candle[] = [];
  let price = start;
  for (let i = 0; i < n; i++) {
    price *= 1 + (next() - 0.5) * 0.035 + Math.sin(i / 55) * 0.0025;
    const spread = price * 0.011;
    out.push({
      date: new Date(Date.UTC(2019, 0, 1) + i * 86_400_000).toISOString(),
      open: price - spread * 0.3,
      high: price + spread,
      low: price - spread,
      close: price,
      volume: 1_000_000 + Math.floor(next() * 400_000),
    });
  }
  return out;
}

export interface EngineSignature {
  trades: number;
  expectancyR: number;
  winRate: number;
  byStrategy: Record<string, number>;
}

/** Recompute the behavioural signature of the current engine. */
export function currentSignature(): EngineSignature {
  const byStrategy: Record<string, number> = {};
  let trades = 0;
  let sumR = 0;
  let wins = 0;

  // Three independent series and two horizons, so a change confined to one
  // strategy or one horizon still moves the signature.
  for (const [seed, start] of [
    [11, 100],
    [977, 42],
    [4242, 1850],
  ] as Array<[number, number]>) {
    const candles = frozenSeries(600, seed, start);
    for (const horizon of ['swing', 'medium'] as Horizon[]) {
      const result = backtestSymbol('FIXTURE', { entry: candles, structure: candles, trend: candles }, horizon, {
        thresholds: DEFAULT_THRESHOLDS,
        costFraction: 0.001,
        maxHoldBars: 40,
        windowBars: 260,
        step: 1,
      });
      for (const t of result) {
        trades++;
        sumR += t.resultR;
        if (t.resultR > 0) wins++;
        byStrategy[t.strategy] = (byStrategy[t.strategy] ?? 0) + 1;
      }
    }
  }

  return {
    trades,
    expectancyR: trades ? Number((sumR / trades).toFixed(4)) : 0,
    winRate: trades ? Number(((wins / trades) * 100).toFixed(1)) : 0,
    byStrategy,
  };
}


// Allow direct execution to regenerate the value stored in calibration.ts.
if (import.meta.main) {
  console.log(JSON.stringify(currentSignature(), null, 2));
}
