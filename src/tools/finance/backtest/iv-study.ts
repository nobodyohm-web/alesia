/**
 * Does implied volatility beat ATR at the job the engine actually uses ATR for?
 *
 * Run with:  bun run src/tools/finance/backtest/iv-study.ts
 *
 * Two hypotheses, deliberately separated because they have different odds and
 * only one has a mechanism:
 *
 *  A. IV forecasts FUTURE REALISED VOLATILITY better than ATR does.
 *     Plausible: IV is forward-looking by construction, ATR is a moving average
 *     of what already happened. If true it is directly actionable — every stop
 *     in trade_setup is sized in ATR, and a stop is a bet on how far price can
 *     travel before the idea is wrong.
 *
 *  B. IV RANK predicts DIRECTION or the size of the next excursion.
 *     The folk rule is "low IV means compression means an imminent breakout".
 *     An earlier probe refuted that on BTC — the lowest DVOL decile produced
 *     SMALLER excursions, and corr(DVOL percentile, future realised vol) was
 *     +0.174, i.e. volatility persists rather than springs. Tested here on 16
 *     years of equity data to see whether the refutation holds.
 *
 * Scale handling: ATR is a mean range, VIX is an annualised standard deviation,
 * so their levels are not comparable out of the box. Correlation is reported
 * raw (scale-free), and MAE only after fitting each predictor's scale on the
 * TRAINING half alone. Fitting on all of it would hand every predictor a free
 * look at the answer.
 */
import { fetchYahooHistory } from './data.js';
import { atrPercent, realizedVolatility, type Candle } from '../indicators.js';
import { bootstrapDifference } from './funding.js';

const PAIRS: Array<{ asset: string; ivIndex: string }> = [
  { asset: 'SPY', ivIndex: '^VIX' },
  { asset: 'QQQ', ivIndex: '^VXN' },
];
const HORIZONS = [10, 21];

function fmt(n: number, d = 3): string {
  return (n >= 0 ? '+' : '') + n.toFixed(d);
}

function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return den(da, db) === 0 ? 0 : num / den(da, db);
}
const den = (da: number, db: number): number => Math.sqrt(da * db);

interface Row {
  index: number;
  iv: number;
  atrAnnual: number;
  trailingVol: number;
  futureVol: Record<number, number>;
  futureMove: Record<number, number>;
  futureReturn: Record<number, number>;
  ivRank: number;
}

function buildRows(candles: Candle[], iv: Map<string, number>): Row[] {
  const closes = candles.map((c) => c.close);
  const atrPct = atrPercent(candles, 14);
  const rows: Row[] = [];

  for (let i = 260; i < candles.length - Math.max(...HORIZONS) - 1; i++) {
    const ivToday = iv.get(candles[i].date.slice(0, 10));
    const a = atrPct[i];
    if (ivToday === undefined || a === null) continue;

    // IV rank: percentile of today's IV within its own trailing year. Trailing
    // only — a rank computed over the whole series would know the future.
    const window: number[] = [];
    for (let j = Math.max(0, i - 251); j <= i; j++) {
      const v = iv.get(candles[j].date.slice(0, 10));
      if (v !== undefined) window.push(v);
    }
    if (window.length < 100) continue;
    const below = window.filter((v) => v < ivToday).length;

    const trailing = realizedVolatility(closes.slice(0, i + 1), 20, 252);
    if (trailing === null) continue;

    const futureVol: Record<number, number> = {};
    const futureMove: Record<number, number> = {};
    const futureReturn: Record<number, number> = {};
    let ok = true;
    for (const h of HORIZONS) {
      const rv = realizedVolatility(closes.slice(0, i + 1 + h).slice(-(h + 1)), h, 252);
      if (rv === null) { ok = false; break; }
      futureVol[h] = rv;
      const slice = candles.slice(i + 1, i + 1 + h);
      const hi = Math.max(...slice.map((c) => c.high));
      const lo = Math.min(...slice.map((c) => c.low));
      futureMove[h] = ((hi - lo) / closes[i]) * 100;
      futureReturn[h] = ((closes[i + h] - closes[i]) / closes[i]) * 100;
    }
    if (!ok) continue;

    rows.push({
      index: i,
      iv: ivToday,
      // ATR is a mean absolute range; scaling by sqrt(252) puts it in the same
      // units family as an annualised vol, and the fitted scale below handles
      // the constant.
      atrAnnual: a * Math.sqrt(252),
      trailingVol: trailing,
      futureVol, futureMove, futureReturn,
      ivRank: (below / window.length) * 100,
    });
  }
  return rows;
}

/** Least-squares scale + intercept, fitted on training rows only. */
function fitScale(pred: number[], target: number[]): { a: number; b: number } {
  const n = pred.length;
  const mp = pred.reduce((x, y) => x + y, 0) / n;
  const mt = target.reduce((x, y) => x + y, 0) / n;
  let num = 0, dd = 0;
  for (let i = 0; i < n; i++) { num += (pred[i] - mp) * (target[i] - mt); dd += (pred[i] - mp) ** 2; }
  const a = dd === 0 ? 0 : num / dd;
  return { a, b: mt - a * mp };
}

const mae = (pred: number[], target: number[], fit: { a: number; b: number }): number =>
  pred.reduce((acc, p, i) => acc + Math.abs(fit.a * p + fit.b - target[i]), 0) / pred.length;

async function main(): Promise<void> {
  console.log('Loading prices and implied-volatility indices...\n');

  for (const { asset, ivIndex } of PAIRS) {
    const candles = await fetchYahooHistory(asset, '1d', '2010-01-01');
    const ivBars = await fetchYahooHistory(ivIndex, '1d', '2010-01-01');
    const iv = new Map(ivBars.map((b) => [b.date.slice(0, 10), b.close]));
    const rows = buildRows(candles, iv);
    console.log(`${asset} vs ${ivIndex}: ${rows.length} observations\n`);

    const mid = Math.floor(rows.length / 2);
    const train = rows.slice(0, mid);
    const test = rows.slice(mid);

    for (const h of HORIZONS) {
      console.log(`  === HYPOTHESIS A: forecasting realised volatility, ${h}d ahead ===`);
      const target = (r: Row[]): number[] => r.map((x) => x.futureVol[h]);
      const preds: Array<[string, (r: Row) => number]> = [
        ['implied (IV index)', (r) => r.iv],
        ['ATR14 annualised', (r) => r.atrAnnual],
        ['trailing realised 20d', (r) => r.trailingVol],
      ];
      for (const [name, get] of preds) {
        const fit = fitScale(train.map(get), target(train));
        const corr = pearson(test.map(get), target(test));
        const err = mae(test.map(get), target(test), fit);
        console.log(`    ${name.padEnd(24)} corr=${fmt(corr)}  MAE=${err.toFixed(2)}pp  (scale fitted on train only)`);
      }

      // The engine's actual question: how far can price travel before the idea
      // is wrong? That is the high-low excursion, not the return.
      console.log(`  === same, but forecasting the ${h}d high-low EXCURSION (what a stop must survive) ===`);
      const exTarget = (r: Row[]): number[] => r.map((x) => x.futureMove[h]);
      for (const [name, get] of preds) {
        const fit = fitScale(train.map(get), exTarget(train));
        const corr = pearson(test.map(get), exTarget(test));
        const err = mae(test.map(get), exTarget(test), fit);
        console.log(`    ${name.padEnd(24)} corr=${fmt(corr)}  MAE=${err.toFixed(2)}pp`);
      }

      // Thin to non-overlapping windows before testing direction. Consecutive
      // daily observations share most of a 21-day forward return, so the
      // effective sample is a fraction of the row count and an unthinned
      // interval is far too narrow. Same correction that dissolved the funding
      // and COT "signals"; applying it only where it is inconvenient would be
      // choosing the answer.
      const thinned = rows.filter((r, i) => i % h === 0);
      console.log(`  === HYPOTHESIS B: does IV rank predict direction, ${h}d ahead (non-overlapping: ${thinned.length}) ===`);
      const all = thinned.map((r) => r.futureReturn[h]);
      for (const [label, filter] of [
        ['IV rank < 20 (calm)', (r: Row) => r.ivRank < 20],
        ['IV rank 20-80', (r: Row) => r.ivRank >= 20 && r.ivRank <= 80],
        ['IV rank > 80 (panic)', (r: Row) => r.ivRank > 80],
      ] as Array<[string, (r: Row) => boolean]>) {
        const bin = thinned.filter(filter).map((r) => r.futureReturn[h]);
        const d = bootstrapDifference(bin, all);
        const mark = d && (d.ci95[0] > 0 || d.ci95[1] < 0) ? '  *' : '';
        console.log(
          `    ${label.padEnd(24)} n=${String(bin.length).padStart(4)}  ` +
            `excess=${d ? fmt(d.diff) : 'n/a'}pp  ${d ? `CI95=[${fmt(d.ci95[0])}, ${fmt(d.ci95[1])}]` : ''}${mark}`,
        );
      }
      console.log('');
    }
  }
  console.log('Hypothesis A uses every day, which is legitimate: it compares three predictors');
  console.log('on the SAME overlapping sample, so the overlap cannot favour one over another.');
  console.log('Hypothesis B is thinned to non-overlapping windows, because there the overlap');
  console.log('would inflate significance against the null rather than cancel out.');
}

main().catch((e) => { console.error(e); process.exit(1); });
