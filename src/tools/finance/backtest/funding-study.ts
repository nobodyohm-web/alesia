/**
 * Does extreme funding predict anything?
 *
 * Run with:  bun run src/tools/finance/backtest/funding-study.ts
 *
 * Design notes, because the answer is only worth as much as the method:
 *  - The z-score is standardised against TRAILING funding only.
 *  - Forward windows are thinned to be non-overlapping before any interval is
 *    computed. Overlapping windows are how a null result becomes a discovery.
 *  - A chronological train/test split, because a signal that only exists in the
 *    period it was found in is not a signal.
 *  - Multiple comparisons are counted and stated. Testing four horizons on two
 *    tails means roughly one 95% "finding" per eight cells by chance alone.
 */
import { fetchBinanceHistory } from './data.js';
import {
  fetchFundingHistory,
  buildObservations,
  summarise,
  bootstrapDifference,
  nonOverlapping,
  type Observation,
} from './funding.js';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'SOLUSDT', 'LINKUSDT', 'LTCUSDT'];
const HORIZONS = [8, 24, 72, 168]; // hours: one settlement, a day, three days, a week
const SPLIT = Date.UTC(2023, 5, 1);

function fmt(n: number, d = 4): string {
  return (n >= 0 ? '+' : '') + n.toFixed(d);
}

/**
 * Report the bin against its own population, not against zero. `clears` marks
 * an EXCESS return whose interval excludes zero — the only kind that could be
 * a signal rather than a restatement of the market's drift.
 */
function line(label: string, values: number[], population: number[]): string {
  const s = summarise(label, values);
  const d = bootstrapDifference(values, population);
  const excess = d ? `excess=${fmt(d.diff, 3)}pp CI95=[${fmt(d.ci95[0], 3)}, ${fmt(d.ci95[1], 3)}]` : 'excess=n/a (n too small)';
  const clears = d ? d.ci95[0] > 0 || d.ci95[1] < 0 : false;
  return (
    `    ${label.padEnd(26)} n=${String(s.n).padStart(5)}  mean=${fmt(s.meanReturn, 3)}%  ` +
    `hit=${s.hitRate.toFixed(1)}%  ${excess}${clears ? '  *' : ''}`
  );
}

async function main(): Promise<void> {
  console.log('Loading funding history and prices (cached after the first run)...\n');

  const all: Observation[] = [];
  for (const symbol of SYMBOLS) {
    try {
      const funding = await fetchFundingHistory(symbol, Date.UTC(2019, 8, 1));
      const klines = await fetchBinanceHistory(symbol, '1h', Date.UTC(2019, 8, 1));
      if (funding.length < 200 || klines.length < 500) {
        console.log(`  ${symbol}: too little history (${funding.length} settlements)`);
        continue;
      }

      // Index hourly closes by bar-open time for an O(1) lookup that never
      // reaches past the timestamp asked for.
      const byHour = new Map<number, number>();
      for (const k of klines) byHour.set(Math.floor(Date.parse(k.date) / 3_600_000), k.close);
      const priceAt = (t: number): number | null => byHour.get(Math.floor(t / 3_600_000)) ?? null;

      const obs = buildObservations(symbol, funding, priceAt, HORIZONS);
      all.push(...obs);
      console.log(`  ${symbol}: ${funding.length} settlements -> ${obs.length} usable observations`);
    } catch (e) {
      console.log(`  ${symbol}: ${(e as Error).message}`);
    }
  }

  console.log(`\nTotal observations: ${all.length}`);
  all.sort((a, b) => a.time - b.time);

  let cells = 0;
  let clearing = 0;

  for (const h of HORIZONS) {
    // Thin FIRST, so every statistic below rests on independent windows.
    const rows = nonOverlapping(all, h);
    const baseline = rows.map((o) => o.forward[h]);
    const baseMean = baseline.reduce((a, b) => a + b, 0) / (baseline.length || 1);

    console.log(`\n=== forward ${h}h (non-overlapping: ${rows.length} of ${all.length}) ===`);
    console.log(`    baseline (all)             n=${String(baseline.length).padStart(5)}  mean=${fmt(baseMean, 3)}%  <- the null every bin must beat`);

    for (const threshold of [1.5, 2, 2.5]) {
      const crowdedLong = rows.filter((o) => o.z >= threshold).map((o) => o.forward[h]);
      const crowdedShort = rows.filter((o) => o.z <= -threshold).map((o) => o.forward[h]);
      // Contrarian hypothesis: crowded longs should UNDERperform the baseline,
      // crowded shorts should outperform.
      console.log(line(`funding z >= +${threshold}`, crowdedLong, baseline));
      console.log(line(`funding z <= -${threshold}`, crowdedShort, baseline));
      cells += 2;
      for (const set of [crowdedLong, crowdedShort]) {
        const d = bootstrapDifference(set, baseline);
        if (d && (d.ci95[0] > 0 || d.ci95[1] < 0)) clearing++;
      }
    }

    // Out-of-sample check on the single most-cited rule.
    const train = rows.filter((o) => o.time < SPLIT);
    const test = rows.filter((o) => o.time >= SPLIT);
    const pick = (set: Observation[]): number[] => set.filter((o) => o.z >= 2).map((o) => o.forward[h]);
    console.log(line('  train z>=+2', pick(train), train.map((o) => o.forward[h])));
    console.log(line('  test  z>=+2', pick(test), test.map((o) => o.forward[h])));
  }

  console.log(`\n--- multiple comparisons ---`);
  console.log(`  ${cells} threshold cells tested; ${clearing} had an interval clearing zero.`);
  console.log(`  At 95% confidence, roughly ${(cells * 0.05).toFixed(1)} would clear zero by chance alone.`);
  console.log('  A "finding" at or below that count is noise wearing a confidence interval.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
