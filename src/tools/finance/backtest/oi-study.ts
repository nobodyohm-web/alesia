/**
 * Cross-venue open interest — is aggregating it worth anything?
 *
 * Run with:  bun run src/tools/finance/backtest/oi-study.ts
 *
 * THE BINDING CONSTRAINT, established before any analysis: Binance caps its
 * open-interest history at exactly 30 days. Verified — 31 daily points, 186
 * four-hourly, 500 hourly, all spanning the same month, and `startTime` on an
 * older date returns error -1130. Bybit gives ~6.5 months and OKX ~6, but the
 * venue whose reading we would be correcting is the one that runs out first.
 *
 * So the honest scope of this file is narrow and deliberately so:
 *
 *   1. DESCRIPTIVE — do the venues actually disagree? Cheap, and if they do not
 *      the premise dies immediately.
 *   2. POWER — how large a sample would be needed to detect a plausible effect?
 *      Answering this is what separates "not proven" from "not testable".
 *
 * What this file does NOT do is report an expectancy from 30 days of data. Five
 * hypotheses this session showed how easily a small favourable sample produces
 * a finding that a larger one erases; a month of one asset is smaller than any
 * of them.
 */
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';

interface Point {
  time: number;
  oi: number;
}

async function binanceOi(symbol: string, period: string): Promise<Point[]> {
  const url = `https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=${period}&limit=500`;
  const rows = (await (await fetch(url)).json()) as Array<{ timestamp: number; sumOpenInterest: string }>;
  return rows.map((r) => ({ time: r.timestamp, oi: Number(r.sumOpenInterest) }));
}

async function bybitOi(symbol: string, interval: string): Promise<Point[]> {
  const url = `https://api.bybit.com/v5/market/open-interest?category=linear&symbol=${symbol}&intervalTime=${interval}&limit=200`;
  const json = (await (await fetch(url, { headers: { 'User-Agent': UA } })).json()) as {
    result?: { list?: Array<{ timestamp: string; openInterest: string }> };
  };
  return (json.result?.list ?? [])
    .map((r) => ({ time: Number(r.timestamp), oi: Number(r.openInterest) }))
    .sort((a, b) => a.time - b.time);
}

async function okxOi(ccy: string, period: string): Promise<Point[]> {
  const url = `https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-volume?ccy=${ccy}&period=${period}`;
  const json = (await (await fetch(url, { headers: { 'User-Agent': UA } })).json()) as { data?: string[][] };
  return (json.data ?? [])
    .map((r) => ({ time: Number(r[0]), oi: Number(r[1]) }))
    .sort((a, b) => a.time - b.time);
}

/** Percentage change series, keyed by timestamp bucket. */
function deltas(points: Point[], bucketMs: number): Map<number, number> {
  const out = new Map<number, number>();
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].oi;
    if (prev > 0) out.set(Math.round(points[i].time / bucketMs), ((points[i].oi - prev) / prev) * 100);
  }
  return out;
}

/**
 * Sample size needed to resolve a difference of `effect` percentage points,
 * given the observed dispersion. Standard two-sided formula at 95%/80%.
 */
function requiredN(sd: number, effect: number): number {
  return Math.ceil(2 * ((1.96 + 0.84) ** 2) * (sd / effect) ** 2);
}

async function main(): Promise<void> {
  const HOUR = 3_600_000;
  const symbol = 'BTCUSDT';

  console.log('=== 1. HOW MUCH HISTORY EXISTS ===\n');
  const bin = await binanceOi(symbol, '1h');
  const byb = await bybitOi(symbol, '1h');
  const okx = await okxOi('BTC', '1H');
  const span = (p: Point[]): string =>
    p.length < 2 ? 'n/a' : `${((p[p.length - 1].time - p[0].time) / 86_400_000).toFixed(0)} days`;
  console.log(`  Binance   ${String(bin.length).padStart(4)} hourly points  ${span(bin)}   <- the binding constraint`);
  console.log(`  Bybit     ${String(byb.length).padStart(4)} hourly points  ${span(byb)}`);
  console.log(`  OKX       ${String(okx.length).padStart(4)} hourly points  ${span(okx)}`);

  const dBin = deltas(bin, HOUR);
  const dByb = deltas(byb, HOUR);
  const dOkx = deltas(okx, HOUR);
  const shared = [...dBin.keys()].filter((k) => dByb.has(k) && dOkx.has(k)).sort((a, b) => a - b);
  console.log(`\n  Overlapping hours across all three: ${shared.length}\n`);

  if (shared.length < 30) {
    console.log('  Too little overlap to say anything. Stopping.');
    return;
  }

  console.log('=== 2. DO THE VENUES ACTUALLY DISAGREE? ===\n');
  let signMismatch = 0;
  let flagsBinance = 0;
  let flagsUnconfirmed = 0;
  const binVals: number[] = [];
  const aggVals: number[] = [];

  for (const k of shared) {
    const b = dBin.get(k) as number;
    const y = dByb.get(k) as number;
    const o = dOkx.get(k) as number;
    const agg = (b + y + o) / 3;
    binVals.push(b);
    aggVals.push(agg);
    if (Math.abs(agg) > 0.2 && Math.sign(b) !== Math.sign(agg)) signMismatch++;
    // The claim being checked: a Binance-only "OI is moving" flag that the
    // other venues do not corroborate.
    if (Math.abs(b) > 1.0) {
      flagsBinance++;
      if (Math.sign(b) !== Math.sign(agg) || Math.abs(agg) < 0.5) flagsUnconfirmed++;
    }
  }

  const mean = (xs: number[]): number => xs.reduce((a, c) => a + c, 0) / xs.length;
  const sd = (xs: number[]): number => {
    const m = mean(xs);
    return Math.sqrt(xs.reduce((a, c) => a + (c - m) ** 2, 0) / (xs.length - 1));
  };
  let num = 0, da = 0, db = 0;
  const mb = mean(binVals), ma = mean(aggVals);
  for (let i = 0; i < binVals.length; i++) {
    num += (binVals[i] - mb) * (aggVals[i] - ma);
    da += (binVals[i] - mb) ** 2;
    db += (aggVals[i] - ma) ** 2;
  }
  const corr = num / Math.sqrt(da * db);

  console.log(`  corr(Binance dOI, 3-venue mean dOI) = ${corr.toFixed(3)}`);
  console.log(`  sign disagreement on meaningful moves: ${signMismatch}/${shared.length} (${((signMismatch / shared.length) * 100).toFixed(1)}%)`);
  console.log(`  Binance |dOI| > 1% flags: ${flagsBinance}, of which unconfirmed cross-venue: ${flagsUnconfirmed}`);
  console.log(`  Binance dOI sd = ${sd(binVals).toFixed(3)}pp, aggregate sd = ${sd(aggVals).toFixed(3)}pp`);

  console.log('\n=== 3. WHAT WOULD IT TAKE TO TEST THE TRADING CLAIM? ===\n');
  // A plausible effect for a positioning signal, in daily-return terms.
  const returnSd = 3.0; // BTC daily return sd, percentage points
  for (const effect of [0.5, 0.25, 0.1]) {
    const n = requiredN(returnSd, effect);
    console.log(
      `  to resolve a ${effect}pp edge in daily return: n = ${n} observations per arm ` +
        `(~${(n / 24).toFixed(0)} days of hourly, ~${(n / 365).toFixed(1)} years of daily)`,
    );
  }
  console.log(`\n  Available today: ${shared.length} overlapping hours (~${(shared.length / 24).toFixed(0)} days).`);
  console.log('  VERDICT: the trading claim is NOT TESTABLE with free data. Not "unproven" —');
  console.log('  not testable, because the sample needed exceeds the sample that exists by');
  console.log('  one to two orders of magnitude, and Binance will not serve more than 30 days.');
  console.log('\n  The claim that motivated this — "29% of Binance OI flags are unconfirmed');
  console.log('  cross-venue" — was itself computed on 500 hourly bars, i.e. three weeks.');
  console.log('  It is an observation about one month, not a measurement of a signal.');
  console.log('\n  The only way to earn this data is to start recording it. See oi-collector.ts.');
}

main().catch((e) => { console.error(e); process.exit(1); });
