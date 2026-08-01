/**
 * Backtest data layer — deep history, cached on disk.
 *
 * Binance is the honest source here: klines paginate back to 2017 for free and
 * carry no survivorship bias. Yahoo only serves instruments that still trade,
 * so any equity expectancy computed from it is a CEILING, not an estimate —
 * every company that went to zero is silently absent from the sample.
 *
 * Everything is cached under .alesia/ (gitignored) so a threshold sweep re-runs
 * in seconds instead of re-downloading a decade of candles each time.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import YahooFinance from 'yahoo-finance2';
import { alesiaPath } from '../../../utils/paths.js';
import type { Candle } from '../indicators.js';
import { aggregateCandles, type Timeframe } from '../candles.js';

const CACHE_DIR = alesiaPath('backtest-cache');

const yahooFinance = new YahooFinance({
  suppressNotices: ['yahooSurvey'],
  validation: { logErrors: false },
});

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

async function readCache(key: string): Promise<Candle[] | null> {
  try {
    return JSON.parse(await readFile(join(CACHE_DIR, `${key}.json`), 'utf-8')) as Candle[];
  } catch {
    return null;
  }
}

async function writeCache(key: string, candles: Candle[]): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(join(CACHE_DIR, `${key}.json`), JSON.stringify(candles), 'utf-8');
}

const BINANCE_INTERVAL: Record<Timeframe, string> = {
  '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1d', '1wk': '1w',
};

/** Milliseconds per bar, used to advance the pagination cursor. */
const INTERVAL_MS: Record<Timeframe, number> = {
  '5m': 300_000, '15m': 900_000, '1h': 3_600_000, '4h': 14_400_000,
  '1d': 86_400_000, '1wk': 604_800_000,
};

/**
 * Page through Binance klines from `sinceMs` to now.
 *
 * The endpoint caps at 1000 bars per request, so the cursor advances by the
 * last bar's open time plus one interval. A run that returns fewer than the
 * limit means we have reached the present.
 */
export async function fetchBinanceHistory(
  symbol: string,
  timeframe: Timeframe,
  sinceMs: number,
  maxRequests = 200,
): Promise<Candle[]> {
  const key = `binance-${symbol}-${timeframe}`;
  const cached = await readCache(key);
  if (cached && cached.length > 0) return cached;

  const out: Candle[] = [];
  let cursor = sinceMs;
  const interval = BINANCE_INTERVAL[timeframe];

  for (let request = 0; request < maxRequests; request++) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${cursor}&limit=1000`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Binance returned HTTP ${resp.status} for ${symbol} ${timeframe}`);
    const rows = (await resp.json()) as unknown[][];
    if (rows.length === 0) break;

    for (const k of rows) {
      const candle: Candle = {
        date: new Date(k[0] as number).toISOString(),
        open: Number(k[1]), high: Number(k[2]), low: Number(k[3]),
        close: Number(k[4]), volume: Number(k[5]),
      };
      if (Number.isFinite(candle.close) && Number.isFinite(candle.high)) out.push(candle);
    }

    const lastOpen = rows[rows.length - 1][0] as number;
    cursor = lastOpen + INTERVAL_MS[timeframe];
    if (rows.length < 1000) break;
  }

  // The final bar is still forming; including it would let the simulator see a
  // high or low that has not happened yet.
  if (out.length > 0) out.pop();
  await writeCache(key, out);
  return out;
}

/** Yahoo daily/weekly history. Survivorship-biased by construction — see header. */
export async function fetchYahooHistory(
  symbol: string,
  timeframe: '1d' | '1wk',
  fromISO = '2005-01-01',
): Promise<Candle[]> {
  const key = `yahoo-${symbol}-${timeframe}`;
  const cached = await readCache(key);
  if (cached && cached.length > 0) return cached;

  const result = (await yahooFinance.chart(symbol, {
    period1: fromISO,
    interval: timeframe,
    includePrePost: false,
  })) as unknown as Record<string, unknown>;

  const quotes = (result.quotes ?? []) as Array<Record<string, unknown>>;
  const candles: Candle[] = quotes
    .filter((q) => isNum(q.close) && isNum(q.open) && isNum(q.high) && isNum(q.low))
    .map((q) => ({
      date: q.date instanceof Date ? q.date.toISOString() : String(q.date),
      open: q.open as number, high: q.high as number, low: q.low as number,
      close: q.close as number, volume: isNum(q.volume) ? (q.volume as number) : 0,
    }))
    // Yahoo's synthetic trailing bar: all four prices equal, zero volume.
    .filter((c) => !(c.volume === 0 && c.open === c.high && c.high === c.low && c.low === c.close));

  // Drop the in-progress final bar for the same reason as Binance.
  if (candles.length > 0) candles.pop();
  await writeCache(key, candles);
  return candles;
}

/** Derive a higher timeframe from a base series, session-aware for equities. */
export function resample(candles: Candle[], factor: number, sessionAware: boolean): Candle[] {
  return aggregateCandles(candles, factor, sessionAware);
}
