/**
 * Does an IV-sized stop actually beat an ATR-sized one?
 *
 * Run with:  bun run src/tools/finance/backtest/iv-stop-study.ts
 *
 * The forecasting study showed implied volatility predicts the coming high-low
 * excursion better than ATR does (corr +0.681 vs +0.627 on SPY). This asks the
 * only question that follows: does that translate into expectancy, or is it a
 * better forecast of something the stop placement was never really limited by?
 *
 * Everything is paired — the SAME symbol, horizon, period and setup logic, with
 * only the volatility unit swapped — so any difference is attributable to the
 * substitution and nothing else.
 *
 * RESULT: NO. Measured 2026-08-01.
 *
 *   SPY / ^VIX   +0.040 -> +0.135   diff +0.094R
 *   QQQ / ^VXN   +0.193 -> +0.407   diff +0.214R
 *   GLD / ^GVZ   +0.116 -> +0.069   diff -0.047R
 *   USO / ^OVX   +0.074 -> -0.027   diff -0.101R
 *   DIA / ^VXD   +0.177 -> -0.211   diff -0.388R
 *   POOLED       +0.123 -> +0.098   diff -0.025R   CI95 [-0.251, +0.213]
 *
 * With only SPY and QQQ the pooled difference was +0.149R and looked like a
 * finding. Adding gold, oil and the Dow flipped it to -0.025R. DIA is the most
 * damning: same market and period as SPY, different index, and the IV stop
 * raised the stop-out rate from 49.0% to 60.0% while cutting target hits from
 * 17.6% to 10.0%.
 *
 * The mechanism, in hindsight: a stop here is placed BEYOND STRUCTURE, with the
 * volatility unit only as a buffer, and it is then capped by maxStopAtr. The
 * structural level does most of the work. Improving the buffer's accuracy by
 * ~9% therefore moves the stop very little, while importing an index whose
 * volatility is not quite this instrument's can move it the wrong way. A better
 * forecast of X does not improve a decision that only weakly depends on X.
 *
 * Consequence: `volatilityUnit` stays an OPT-IN research parameter on
 * buildLevels. Nothing in production uses it, and nothing should until some
 * variant of this test comes back positive.
 */
import { fetchYahooHistory } from './data.js';
import { backtestSymbol, computeMetrics, type SimTrade } from './harness.js';
import type { Candle } from '../indicators.js';
import { bootstrapDifference } from './funding.js';

/**
 * Validated pairings only for the primary test. `^VIX` was shown to forecast
 * SPY's excursion and `^VXN` QQQ's; nothing established that either forecasts
 * an individual name's volatility, so those are reported separately and flagged.
 */
const VALIDATED: Array<[string, string]> = [
  ['SPY', '^VIX'],
  ['QQQ', '^VXN'],
  // Gold and oil matter most here: different asset classes with their own
  // volatility indices, so they test the MECHANISM rather than re-testing the
  // same US equity period from a second angle. If an IV-sized stop only helps
  // on SPY and QQQ, that is a period artefact; if it helps on GLD and USO too,
  // the effect is about volatility forecasting rather than about equities.
  ['GLD', '^GVZ'],
  ['USO', '^OVX'],
  // DIA is deliberately last and largely redundant with SPY — same market, same
  // period. Its ^VXD feed also stopped updating in mid-July 2026, which is fine
  // for a backtest and disqualifying for live use.
  ['DIA', '^VXD'],
];

/** Individual names, all sized from ^VIX — an UNVALIDATED extension. */
const NAMES = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'JPM', 'XOM', 'KO', 'WMT'];

function fmt(n: number, d = 4): string {
  return (n >= 0 ? '+' : '') + n.toFixed(d);
}

function report(label: string, atrTrades: SimTrade[], ivTrades: SimTrade[]): void {
  const a = computeMetrics(atrTrades);
  const b = computeMetrics(ivTrades);
  if (a.trades === 0 || b.trades === 0) {
    console.log(`  ${label.padEnd(22)} no trades`);
    return;
  }
  const d = bootstrapDifference(ivTrades.map((t) => t.resultR), atrTrades.map((t) => t.resultR));
  const clears = d ? d.ci95[0] > 0 || d.ci95[1] < 0 : false;
  console.log(
    `  ${label.padEnd(22)} ATR n=${String(a.trades).padStart(4)} exp=${fmt(a.expectancyR ?? 0)}  |  ` +
      `IV n=${String(b.trades).padStart(4)} exp=${fmt(b.expectancyR ?? 0)}  |  ` +
      `diff=${d ? fmt(d.diff) : 'n/a'}R ${d ? `CI95=[${fmt(d.ci95[0])}, ${fmt(d.ci95[1])}]` : ''}${clears ? '  *' : ''}`,
  );
  console.log(
    `  ${''.padEnd(22)} stopped ${((a.byOutcome.stop ?? 0) / a.trades * 100).toFixed(1)}% vs ` +
      `${((b.byOutcome.stop ?? 0) / b.trades * 100).toFixed(1)}%   ` +
      `target ${((a.byOutcome.target ?? 0) / a.trades * 100).toFixed(1)}% vs ` +
      `${((b.byOutcome.target ?? 0) / b.trades * 100).toFixed(1)}%`,
  );
}

async function loadIv(index: string): Promise<Map<string, number>> {
  const bars = await fetchYahooHistory(index, '1d', '2005-01-01');
  return new Map(bars.map((b) => [b.date.slice(0, 10), b.close]));
}

function run(
  symbol: string,
  daily: Candle[],
  weekly: Candle[],
  iv: Map<string, number> | undefined,
): SimTrade[] {
  return backtestSymbol(symbol, { entry: daily, structure: daily, trend: weekly }, 'medium', {
    costFraction: 0.0006,
    maxHoldBars: 60,
    windowBars: 260,
    ivByDate: iv,
    barsPerYear: 252,
  });
}

async function main(): Promise<void> {
  console.log('Loading prices and implied-volatility indices...\n');
  const indices = new Map<string, Map<string, number>>();
  for (const index of ['^VIX', '^VXN', '^GVZ', '^OVX', '^VXD']) {
    indices.set(index, await loadIv(index));
  }
  const vix = indices.get('^VIX') as Map<string, number>;

  console.log('=== PRIMARY: validated index pairings, medium horizon ===');
  console.log('  * = the difference interval excludes zero\n');
  const allAtr: SimTrade[] = [];
  const allIv: SimTrade[] = [];

  for (const [symbol, index] of VALIDATED) {
    const daily = await fetchYahooHistory(symbol, '1d', '2005-01-01');
    const weekly = await fetchYahooHistory(symbol, '1wk', '2005-01-01');
    const iv = indices.get(index) as Map<string, number>;
    const atrTrades = run(symbol, daily, weekly, undefined);
    const ivTrades = run(symbol, daily, weekly, iv);
    report(`${symbol} / ${index}`, atrTrades, ivTrades);
    allAtr.push(...atrTrades);
    allIv.push(...ivTrades);
  }
  console.log('');
  report('POOLED (validated)', allAtr, allIv);

  console.log('\n=== SECONDARY: individual names sized from ^VIX ===');
  console.log('  UNVALIDATED — nothing established that ^VIX forecasts a single');
  console.log('  name\'s excursion. Reported so the reader can see it, not to be believed.\n');
  const nameAtr: SimTrade[] = [];
  const nameIv: SimTrade[] = [];
  for (const symbol of NAMES) {
    try {
      const daily = await fetchYahooHistory(symbol, '1d', '2005-01-01');
      const weekly = await fetchYahooHistory(symbol, '1wk', '2005-01-01');
      nameAtr.push(...run(symbol, daily, weekly, undefined));
      nameIv.push(...run(symbol, daily, weekly, vix));
    } catch (e) {
      console.log(`  ${symbol}: ${(e as Error).message}`);
    }
  }
  report('POOLED (names)', nameAtr, nameIv);

  console.log('\nBoth arms trade the SAME symbols over the SAME period with the SAME setup');
  console.log('logic; only the volatility unit differs, so any gap is attributable to it.');
}

main().catch((e) => { console.error(e); process.exit(1); });
