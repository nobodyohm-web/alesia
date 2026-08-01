/**
 * Unified candle provider — one OHLCV interface over equities and crypto.
 *
 * The technical layer must not care whether a symbol trades on Nasdaq or
 * Binance: an ATR stop is computed the same way either side. This module is
 * the only place that knows the difference, so every analysis tool downstream
 * works on both asset classes without branching.
 */
import YahooFinance from 'yahoo-finance2';
import { MainClient } from 'binance';
import { withRetry, withTimeout, memoize } from '../../utils/retry.js';
import { TTL_15M, TTL_1H } from './utils.js';
import type { Candle } from './indicators.js';

// yahoo-finance2 v3 requires instantiation, matching yahoo.ts.
const yahooFinance = new YahooFinance({
  suppressNotices: ['yahooSurvey'],
  validation: { logErrors: false },
});

const binance = new MainClient({});

const FETCH_TIMEOUT_MS = 15_000;
const guarded = <T>(call: () => Promise<T>, label: string): Promise<T> =>
  withRetry(() => withTimeout(call(), FETCH_TIMEOUT_MS, label), { maxRetries: 1, baseDelayMs: 400 });

/** Timeframes the analysis layer speaks, independent of the venue. */
export type Timeframe = '5m' | '15m' | '1h' | '4h' | '1d' | '1wk';

export type Market = 'auto' | 'equity' | 'crypto';

/** Approximate bars per year, used to annualise volatility per timeframe. */
export const BARS_PER_YEAR: Record<Timeframe, number> = {
  // Equities: 6.5h session -> 78 five-minute bars, 26 fifteen-minute, ~7 hourly.
  '5m': 78 * 252,
  '15m': 26 * 252,
  '1h': 7 * 252,
  '4h': 2 * 252,
  '1d': 252,
  '1wk': 52,
};

/** Same, for a 24/7 crypto market. */
export const CRYPTO_BARS_PER_YEAR: Record<Timeframe, number> = {
  '5m': 288 * 365,
  '15m': 96 * 365,
  '1h': 24 * 365,
  '4h': 6 * 365,
  '1d': 365,
  '1wk': 52,
};

/** Bare crypto tickers users type without the quote asset. */
const KNOWN_CRYPTO = new Set([
  'BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOGE', 'DOT', 'AVAX', 'MATIC', 'LINK', 'LTC', 'BCH', 'ATOM',
  'UNI', 'ETC', 'XLM', 'NEAR', 'ALGO', 'FIL', 'ICP', 'APT', 'ARB', 'OP', 'SUI', 'INJ', 'TIA', 'SEI',
  'PEPE', 'SHIB', 'BNB', 'TRX', 'TON', 'RNDR', 'IMX', 'AAVE', 'MKR', 'CRV', 'LDO', 'GRT', 'SAND',
]);

const QUOTE_ASSETS = ['USDT', 'USDC', 'BUSD', 'FDUSD', 'TUSD'];

export interface ResolvedSymbol {
  /** The symbol as the venue expects it. */
  symbol: string;
  market: 'equity' | 'crypto';
  /** What the user typed, for echoing back. */
  input: string;
}

/**
 * Decide which venue a symbol belongs to.
 *
 * Explicit beats inferred: `market` is only guessed when the caller says
 * 'auto'. The heuristic deliberately does not treat every 3-letter string as
 * crypto — plenty of equity tickers collide, so only an explicit quote-asset
 * suffix or a known crypto name qualifies.
 */
export function resolveSymbol(input: string, market: Market = 'auto'): ResolvedSymbol {
  const raw = input.trim().toUpperCase();

  if (market === 'equity') return { symbol: raw, market: 'equity', input: raw };

  const hasQuoteSuffix = QUOTE_ASSETS.some((q) => raw.endsWith(q) && raw.length > q.length);
  if (market === 'crypto') {
    return { symbol: hasQuoteSuffix ? raw : `${raw}USDT`, market: 'crypto', input: raw };
  }

  // auto
  if (hasQuoteSuffix) return { symbol: raw, market: 'crypto', input: raw };
  if (KNOWN_CRYPTO.has(raw)) return { symbol: `${raw}USDT`, market: 'crypto', input: raw };
  // Yahoo's own crypto notation, e.g. BTC-USD.
  if (/^[A-Z]{2,10}-USD$/.test(raw)) return { symbol: `${raw.split('-')[0]}USDT`, market: 'crypto', input: raw };
  return { symbol: raw, market: 'equity', input: raw };
}

/** Yahoo caps intraday history hard; asking beyond it returns an empty series. */
const YAHOO_MAX_DAYS: Record<Timeframe, number> = {
  '5m': 55,
  '15m': 55,
  '1h': 700,
  '4h': 700,
  '1d': 3650,
  '1wk': 7300,
};

const YAHOO_INTERVAL: Record<Timeframe, string> = {
  '5m': '5m',
  '15m': '15m',
  '1h': '1h',
  // Yahoo has no 4h bar; hourly bars get folded into 4h below.
  '4h': '1h',
  '1d': '1d',
  '1wk': '1wk',
};

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Merge a run of bars into a single OHLCV bar. */
function mergeGroup(group: Candle[]): Candle {
  return {
    date: group[0].date,
    open: group[0].open,
    high: Math.max(...group.map((c) => c.high)),
    low: Math.min(...group.map((c) => c.low)),
    close: group[group.length - 1].close,
    volume: group.reduce((a, c) => a + c.volume, 0),
  };
}

/**
 * Aggregate N consecutive bars into one.
 *
 * `sessionAware` restarts the grouping at each calendar day, which is required
 * for equities: chunking a continuous stream by 4 produces "4h bars" spanning
 * from one afternoon into the next morning, whose high and low describe no
 * period any trader experienced. Crypto trades 24/7 and needs no such reset.
 */
export function aggregateCandles(candles: Candle[], factor: number, sessionAware = false): Candle[] {
  if (factor <= 1) return candles;
  const out: Candle[] = [];

  if (!sessionAware) {
    for (let i = 0; i < candles.length; i += factor) {
      const group = candles.slice(i, i + factor);
      if (group.length > 0) out.push(mergeGroup(group));
    }
    return out;
  }

  let day: string | null = null;
  let bucket: Candle[] = [];
  const flush = (): void => {
    if (bucket.length > 0) out.push(mergeGroup(bucket));
    bucket = [];
  };
  for (const candle of candles) {
    const candleDay = candle.date.slice(0, 10);
    if (candleDay !== day) {
      flush();
      day = candleDay;
    }
    bucket.push(candle);
    if (bucket.length === factor) flush();
  }
  flush();
  return out;
}

/**
 * Drop Yahoo's synthetic trailing bar.
 *
 * Yahoo appends a placeholder for the in-progress period whose OHLC are all the
 * last price and whose volume is zero. Left in, it flattens the final ATR bar
 * and can plant a phantom support or resistance exactly at the current price.
 */
function isSyntheticBar(c: Candle): boolean {
  return c.volume === 0 && c.open === c.high && c.high === c.low && c.low === c.close;
}

/** UTC Monday of the week a timestamp falls in — a stable weekly bucket key. */
function weekKey(iso: string): string {
  const d = new Date(iso);
  const day = d.getUTCDay();
  // getUTCDay is 0 for Sunday, so Sunday shifts back six days, not forward one.
  const monday = new Date(d.getTime() + (day === 0 ? -6 : 1 - day) * 86_400_000);
  return monday.toISOString().slice(0, 10);
}

/**
 * Drop Yahoo's duplicate trailing weekly bar.
 *
 * On a `1wk` request Yahoo returns the in-progress week TWICE: once correctly
 * aggregated (dated to the Monday, carrying the whole week's range and volume)
 * and once again dated to the latest session, carrying only that last day.
 * Both share the same close, so a naive length check misses it while the
 * spurious bar silently truncates the week's real high and low.
 *
 * This matters more than it looks: the weekly chart sets the directional bias
 * for both the medium and long horizons, so the corrupted bar would skew the
 * trend read, the swing structure and the stop base on every long-term call.
 *
 * Exported for testing — this is a regression guard, not a detail.
 */
export function dropDuplicateWeeklyBar(candles: Candle[]): Candle[] {
  if (candles.length < 2) return candles;
  const lastBar = candles[candles.length - 1];
  const priorBar = candles[candles.length - 2];
  if (weekKey(lastBar.date) !== weekKey(priorBar.date)) return candles;
  // Keep whichever bar actually aggregates the week. Volume is the reliable
  // discriminator: the true weekly bar holds every session's volume, the
  // spurious one only the final session's.
  return lastBar.volume > priorBar.volume
    ? [...candles.slice(0, -2), lastBar]
    : candles.slice(0, -1);
}

async function fetchEquityCandles(symbol: string, timeframe: Timeframe, bars: number): Promise<Candle[]> {
  const interval = YAHOO_INTERVAL[timeframe];
  // Over-request: weekends, holidays and half-days mean calendar span and bar
  // count diverge badly, especially on intraday.
  const barsPerDay =
    timeframe === '5m' ? 78 : timeframe === '15m' ? 26 : timeframe === '1h' || timeframe === '4h' ? 7 : 1;
  const factor = timeframe === '4h' ? 4 : 1;
  const neededBars = bars * factor;
  const calendarDays =
    timeframe === '1wk'
      ? neededBars * 7 + 30
      : timeframe === '1d'
        ? Math.ceil(neededBars * 1.5) + 10
        : Math.ceil(neededBars / barsPerDay) + 10;

  const days = Math.min(calendarDays, YAHOO_MAX_DAYS[timeframe]);
  const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const result = (await guarded(
    () =>
      yahooFinance.chart(symbol, {
        period1: start.toISOString().split('T')[0],
        interval: interval as '5m' | '15m' | '1h' | '1d' | '1wk',
        // Extended-hours prints are thin enough to leave 15-point wicks on a
        // bar that closes flat. Left in, they inflate ATR, drag the Donchian
        // low far below anything reachable, and manufacture support levels at
        // prices no meaningful size ever traded.
        includePrePost: false,
      }),
    `yahoo.chart ${symbol} ${timeframe}`,
  )) as unknown as Record<string, unknown>;

  const quotes = (result.quotes ?? []) as Array<Record<string, unknown>>;
  const candles: Candle[] = quotes
    // A null OHLC field would coerce to a finite 0, fabricating a -100% move
    // and a period low of zero.
    .filter((q) => isNum(q.close) && isNum(q.open) && isNum(q.high) && isNum(q.low))
    .map((q) => ({
      date: q.date instanceof Date ? q.date.toISOString() : String(q.date),
      open: q.open as number,
      high: q.high as number,
      low: q.low as number,
      close: q.close as number,
      volume: isNum(q.volume) ? (q.volume as number) : 0,
    }))
    .filter((c) => !isSyntheticBar(c));

  const deduped = timeframe === '1wk' ? dropDuplicateWeeklyBar(candles) : candles;
  return aggregateCandles(deduped, factor, true).slice(-bars);
}

const BINANCE_INTERVAL: Record<Timeframe, string> = {
  '5m': '5m',
  '15m': '15m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1d',
  '1wk': '1w',
};

async function fetchCryptoCandles(symbol: string, timeframe: Timeframe, bars: number): Promise<Candle[]> {
  const klines = await guarded(
    () =>
      binance.getKlines({
        symbol,
        interval: BINANCE_INTERVAL[timeframe] as '5m' | '15m' | '1h' | '4h' | '1d' | '1w',
        limit: Math.min(bars, 1000),
      }),
    `binance.klines ${symbol} ${timeframe}`,
  );

  return (klines as unknown[][])
    .map((k) => ({
      date: new Date(k[0] as number).toISOString(),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
    }))
    .filter((c) => Number.isFinite(c.close) && Number.isFinite(c.high) && Number.isFinite(c.low));
}

export interface CandleSet {
  resolved: ResolvedSymbol;
  timeframe: Timeframe;
  candles: Candle[];
  barsPerYear: number;
}

/**
 * Fetch normalised candles for any symbol on any supported timeframe.
 *
 * Intraday data is cached briefly and daily data for an hour: a multi-timeframe
 * analysis asks for the same daily series several times in one turn, and
 * re-fetching it is pure latency.
 */
export async function getCandles(
  input: string,
  timeframe: Timeframe,
  bars: number,
  market: Market = 'auto',
): Promise<CandleSet> {
  const resolved = resolveSymbol(input, market);
  const ttl = timeframe === '5m' || timeframe === '15m' ? TTL_15M : TTL_1H;

  const candles = await memoize(`candles:${resolved.market}:${resolved.symbol}:${timeframe}:${bars}`, ttl, () =>
    resolved.market === 'crypto'
      ? fetchCryptoCandles(resolved.symbol, timeframe, bars)
      : fetchEquityCandles(resolved.symbol, timeframe, bars),
  );

  return {
    resolved,
    timeframe,
    candles,
    barsPerYear: resolved.market === 'crypto' ? CRYPTO_BARS_PER_YEAR[timeframe] : BARS_PER_YEAR[timeframe],
  };
}
