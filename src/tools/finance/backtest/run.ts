/**
 * Calibration runner — measures the engine, then sweeps its thresholds.
 *
 * Run with:  bun run src/tools/finance/backtest/run.ts [baseline|sweep]
 *
 * Crypto carries the calibration. Binance klines reach back to 2017 with no
 * survivorship bias, whereas Yahoo only serves instruments that still trade —
 * so any equity expectancy here is a CEILING, and is labelled as such.
 *
 * The sweep uses a chronological train/test split. Reporting the best value
 * found on the data it was chosen from is not calibration, it is curve fitting
 * with extra steps.
 */
import { fetchBinanceHistory, fetchYahooHistory, resample } from './data.js';
import { backtestSymbol, computeMetrics, type SimTrade } from './harness.js';
import { DEFAULT_THRESHOLDS, type Thresholds } from '../thresholds.js';
import type { Horizon } from '../horizons.js';
import type { Candle } from '../indicators.js';

const CRYPTO = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'SOLUSDT', 'LINKUSDT', 'LTCUSDT'];
const EQUITY = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'JPM', 'XOM', 'KO', 'WMT'];

const SINCE = Date.UTC(2017, 7, 17); // first BTCUSDT kline

interface Dataset {
  symbol: string;
  market: 'crypto' | 'equity';
  series: Record<Horizon, { entry: Candle[]; structure: Candle[]; trend: Candle[] } | null>;
}

/**
 * How far back to pull 5-minute bars.
 *
 * Two years rather than the full 2017 history: that is ~210k bars per symbol,
 * and intraday microstructure — fee tiers, maker/taker mix, who is providing
 * liquidity — has changed enough since 2017 that older 5m data would answer a
 * question about a market that no longer exists. Deliberately narrower than the
 * swing sample, and the smaller n is reported as such.
 */
const DAY_LOOKBACK_MS = 2 * 365 * 24 * 60 * 60 * 1000;

async function loadCrypto(symbol: string, withIntraday: boolean): Promise<Dataset> {
  const h1 = await fetchBinanceHistory(symbol, '1h', SINCE);
  const d1 = await fetchBinanceHistory(symbol, '1d', SINCE);
  const w1 = await fetchBinanceHistory(symbol, '1wk', SINCE);
  const h4 = resample(h1, 4, false); // crypto trades 24/7 — no session reset

  let dayseries: Dataset['series']['day'] = null;
  if (withIntraday) {
    const since = Date.now() - DAY_LOOKBACK_MS;
    const m5 = await fetchBinanceHistory(symbol, '5m', since, 400);
    const m15 = await fetchBinanceHistory(symbol, '15m', since, 200);
    if (m5.length > 5000 && m15.length > 1000) {
      dayseries = { entry: m5, structure: m15, trend: h1 };
    }
  }

  return {
    symbol,
    market: 'crypto',
    series: {
      day: dayseries,
      swing: h1.length > 500 ? { entry: h1, structure: h4, trend: d1 } : null,
      medium: d1.length > 300 ? { entry: d1, structure: d1, trend: w1 } : null,
      long: d1.length > 300 && w1.length > 100 ? { entry: d1, structure: w1, trend: w1 } : null,
    },
  };
}

async function loadEquity(symbol: string): Promise<Dataset> {
  const d1 = await fetchYahooHistory(symbol, '1d');
  const w1 = await fetchYahooHistory(symbol, '1wk');
  return {
    symbol,
    market: 'equity',
    series: {
      day: null,
      swing: null, // needs intraday Yahoo cannot serve this far back
      medium: d1.length > 300 ? { entry: d1, structure: d1, trend: w1 } : null,
      long: d1.length > 300 && w1.length > 100 ? { entry: d1, structure: w1, trend: w1 } : null,
    },
  };
}

/** Costs differ by venue and by how often the horizon turns over. */
function costFor(market: 'crypto' | 'equity', horizon: Horizon): number {
  if (market === 'crypto') return 0.002; // Binance taker round trip
  return horizon === 'medium' ? 0.0006 : 0.0004; // equity spread + slippage
}

function holdFor(horizon: Horizon): number {
  // 48 five-minute bars is four hours — the outer edge of "minutes to hours,
  // flat by the close" that the day horizon promises.
  return horizon === 'day' ? 48 : horizon === 'swing' ? 120 : horizon === 'medium' ? 60 : 52;
}

function report(label: string, trades: SimTrade[]): void {
  const m = computeMetrics(trades);
  if (m.trades === 0) {
    console.log(`${label.padEnd(28)} no trades`);
    return;
  }
  const ci = m.expectancyCI ? `[${m.expectancyCI[0].toFixed(3)}, ${m.expectancyCI[1].toFixed(3)}]` : 'n/a';
  const significant = m.expectancyCI ? (m.expectancyCI[0] > 0 ? ' *' : m.expectancyCI[1] < 0 ? ' !' : '') : '';
  console.log(
    `${label.padEnd(28)} n=${String(m.trades).padStart(5)}  ` +
      `exp=${(m.expectancyR ?? 0).toFixed(4)}R  CI95=${ci.padEnd(20)}  ` +
      `win=${(m.winRate ?? 0).toFixed(1)}%  avgW=${(m.avgWinR ?? 0).toFixed(2)}  avgL=${(m.avgLossR ?? 0).toFixed(2)}  ` +
      `maxDD=${(m.maxDrawdownR ?? 0).toFixed(1)}R  ${JSON.stringify(m.byOutcome)}${significant}`,
  );
}

/**
 * How many bars to skip between decision points.
 *
 * On hourly data a full walk means re-deriving the whole state 75,000 times per
 * symbol, which makes a six-grid sweep take hours. Sampling every 3rd bar on an
 * hourly series still leaves 8 decision points a day against a 120-bar holding
 * period, so the trade population barely changes — but the sweep finishes.
 * Daily and weekly series are cheap enough to walk in full.
 */
function stepFor(market: 'crypto' | 'equity', horizon: Horizon): number {
  if (horizon === 'day') return 3;
  return market === 'crypto' && horizon === 'swing' ? 3 : 1;
}

function runAll(datasets: Dataset[], horizon: Horizon, thresholds: Thresholds, costOverride?: number): SimTrade[] {
  const all: SimTrade[] = [];
  for (const ds of datasets) {
    const series = ds.series[horizon];
    if (!series) continue;
    all.push(
      ...backtestSymbol(ds.symbol, series, horizon, {
        thresholds,
        costFraction: costOverride ?? costFor(ds.market, horizon),
        maxHoldBars: holdFor(horizon),
        windowBars: 260,
        step: stepFor(ds.market, horizon),
      }),
    );
  }
  return all;
}

/** Split chronologically: a random split would let the future train the past. */
function splitByDate(trades: SimTrade[], pivotISO: string): { train: SimTrade[]; test: SimTrade[] } {
  return {
    train: trades.filter((t) => t.entryDate < pivotISO),
    test: trades.filter((t) => t.entryDate >= pivotISO),
  };
}

const SPLIT_DATE = '2023-06-01T00:00:00.000Z';

async function main(): Promise<void> {
  const mode = process.argv[2] ?? 'baseline';
  const universe = mode === 'day' ? CRYPTO.slice(0, 4) : CRYPTO;
  console.log('Loading history (cached after the first run)...');

  const datasets: Dataset[] = [];
  for (const s of universe) {
    try { datasets.push(await loadCrypto(s, mode === 'day')); } catch (e) { console.log(`  ${s}: ${(e as Error).message}`); }
  }
  for (const s of mode === 'day' ? [] : EQUITY) {
    try { datasets.push(await loadEquity(s)); } catch (e) { console.log(`  ${s}: ${(e as Error).message}`); }
  }

  const crypto = datasets.filter((d) => d.market === 'crypto');
  const equity = datasets.filter((d) => d.market === 'equity');
  console.log(`Loaded ${crypto.length} crypto, ${equity.length} equity symbols\n`);

  const horizons: Horizon[] = ['swing', 'medium', 'long'];

  if (mode === 'day') {
    console.log('=== DAY HORIZON (1h bias / 15m structure / 5m trigger) ===');
    console.log('  * = CI entirely above zero   ! = CI entirely below zero\n');

    // Cost sensitivity IS the analysis at this horizon. A day-trade edge is
    // small and repeated, so the question is never "is there a signal" but
    // "does the signal survive the round trip". Reported gross first, then at
    // three real fee tiers, so the break-even cost is visible.
    const tiers: Array<[string, number]> = [
      ['gross (no costs)', 0],
      ['futures VIP, 8bp', 0.0008],
      ['spot with BNB, 15bp', 0.0015],
      ['spot taker, 20bp', 0.002],
    ];
    for (const [label, cost] of tiers) {
      report(label, runAll(crypto, 'day', DEFAULT_THRESHOLDS, cost));
    }

    console.log('');
    const atRealCost = runAll(crypto, 'day', DEFAULT_THRESHOLDS, 0.0015);
    for (const strat of ['trend-pullback', 'breakout', 'range-reversion']) {
      const sub = atRealCost.filter((t) => t.strategy === strat);
      if (sub.length >= 30) report(`  └ ${strat} @15bp`, sub);
    }

    console.log('');
    const { train, test } = splitByDate(atRealCost, SPLIT_DATE);
    report('  train (< 2023-06) @15bp', train);
    report('  test  (>= 2023-06) @15bp', test);
    return;
  }

  if (mode === 'baseline') {
    console.log('=== BASELINE (default thresholds) ===');
    console.log('  * = CI entirely above zero   ! = CI entirely below zero\n');
    for (const h of horizons) {
      const c = runAll(crypto, h, DEFAULT_THRESHOLDS);
      const e = runAll(equity, h, DEFAULT_THRESHOLDS);
      report(`crypto ${h}`, c);
      report(`equity ${h} (ceiling)`, e);
      // Strategy breakdown reveals which setup type actually carries the edge.
      for (const strat of ['trend-pullback', 'breakout', 'range-reversion']) {
        const sub = [...c, ...e].filter((t) => t.strategy === strat);
        if (sub.length >= 30) report(`   └ ${strat}`, sub);
      }
      console.log('');
    }
    return;
  }

  // --- Sweep -------------------------------------------------------------
  console.log(`=== SWEEP (train < ${SPLIT_DATE.slice(0, 10)} <= test) ===\n`);
  // Four grids, not six: each extra parameter swept on the same data raises the
  // chance that the best-looking value is noise. These are the four that gate
  // whether a trade is taken at all.
  const grids: Array<{ key: keyof Thresholds; values: number[] }> = [
    { key: 'adxSetupTrending', values: [14, 18, 22, 26, 30] },
    { key: 'stretchedAtr', values: [1.0, 1.5, 2.0, 3.0] },
    { key: 'nearMeanAtr', values: [0.5, 1.0, 1.5, 2.0] },
    { key: 'adxDirectionGate', values: [14, 20, 26] },
  ];

  for (const h of horizons) {
    console.log(`--- ${h} ---`);
    for (const grid of grids) {
      const rows: string[] = [];
      for (const value of grid.values) {
        const thresholds = { ...DEFAULT_THRESHOLDS, [grid.key]: value };
        const trades = [...runAll(crypto, h, thresholds), ...runAll(equity, h, thresholds)];
        const { train, test } = splitByDate(trades, SPLIT_DATE);
        const trainM = computeMetrics(train);
        const testM = computeMetrics(test);
        const mark = value === (DEFAULT_THRESHOLDS[grid.key] as number) ? '<' : ' ';
        rows.push(
          `    ${String(value).padStart(5)}${mark} train n=${String(trainM.trades).padStart(4)} ` +
            `exp=${(trainM.expectancyR ?? 0).toFixed(4)}  |  test n=${String(testM.trades).padStart(4)} ` +
            `exp=${(testM.expectancyR ?? 0).toFixed(4)}`,
        );
      }
      console.log(`  ${grid.key}:`);
      rows.forEach((r) => console.log(r));
    }
    console.log('');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
