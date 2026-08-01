/**
 * Sector Performance Tool — Free GICS sector snapshot via Yahoo.
 *
 * Returns the 11 SPDR sector ETFs (XLK / XLF / XLE / ...) plus benchmarks
 * (SPY / QQQ / IWM) in one call. Saves the LLM from making 14 individual
 * yahoo_quote calls.
 *
 * Used by macro-radar and sector-comparison to identify sector rotations
 * and risk-on / risk-off signals.
 */
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import YahooFinance from 'yahoo-finance2';
import { formatToolResult } from '../types.js';
import { withRetry, withTimeout, memoize } from '../../utils/retry.js';

const yahooFinance = new YahooFinance({
  suppressNotices: ['yahooSurvey'],
  validation: { logErrors: false },
});
const YAHOO_TIMEOUT_MS = 12_000;

export const SECTOR_PERFORMANCE_DESCRIPTION = `
Returns a snapshot of the 11 S&P 500 GICS sector ETFs plus SPY/QQQ/IWM benchmarks (free).
Provides: price, day %, 5-day %, YTD %, market cap, 52-week range. Use to identify
sector rotation, risk-on / risk-off signals, and to anchor macro-radar / sector-comparison
analysis with grounded data instead of LLM-recalled rankings.
`.trim();

interface SectorEtf {
  ticker: string;
  sector: string;
  emoji: string;
}

// SPDR sector ETFs — one per GICS sector. Ordered by typical risk-on → risk-off bias.
const SECTOR_ETFS: SectorEtf[] = [
  { ticker: 'XLK', sector: 'Information Technology', emoji: '💻' },
  { ticker: 'XLY', sector: 'Consumer Discretionary', emoji: '🛍️' },
  { ticker: 'XLC', sector: 'Communication Services', emoji: '📡' },
  { ticker: 'XLF', sector: 'Financials', emoji: '🏦' },
  { ticker: 'XLI', sector: 'Industrials', emoji: '🏭' },
  { ticker: 'XLB', sector: 'Materials', emoji: '⚒️' },
  { ticker: 'XLE', sector: 'Energy', emoji: '⛽' },
  { ticker: 'XLP', sector: 'Consumer Staples', emoji: '🥫' },
  { ticker: 'XLV', sector: 'Health Care', emoji: '🏥' },
  { ticker: 'XLU', sector: 'Utilities', emoji: '⚡' },
  { ticker: 'XLRE', sector: 'Real Estate', emoji: '🏢' },
];

const BENCHMARKS: SectorEtf[] = [
  { ticker: 'SPY', sector: 'S&P 500', emoji: '🇺🇸' },
  { ticker: 'QQQ', sector: 'Nasdaq 100', emoji: '🚀' },
  { ticker: 'IWM', sector: 'Russell 2000', emoji: '🏛️' },
];

const SectorPerformanceSchema = z.object({
  includeBenchmarks: z
    .boolean()
    .default(true)
    .describe('Include SPY/QQQ/IWM as comparison benchmarks. Defaults to true.'),
});

// Yahoo is inconsistent about units. `regularMarketChangePercent`,
// `fiftyTwoWeekChangePercent` and `ytdReturn` are already in percentage points
// (-0.216235 means -0.22%), while the `*AverageChangePercent` family is a ratio
// (-0.0019 means -0.19%). Multiplying the first group by 100 inflated every
// sector return by 100x, so each field is now converted with the right helper.

/** Round a value that is already expressed in percentage points. */
export function pctPoints(num: unknown): number | null {
  if (typeof num !== 'number' || !Number.isFinite(num)) return null;
  return Number(num.toFixed(2));
}

/** Convert a ratio (0.0364) into percentage points (3.64). */
export function pctFromRatio(num: unknown): number | null {
  if (typeof num !== 'number' || !Number.isFinite(num)) return null;
  return Number((num * 100).toFixed(2));
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

interface SectorRow {
  ticker: string;
  sector: string;
  emoji: string;
  price: number | null;
  dayChangePct: number | null;
  fiveDayChangePct: number | null;
  ytdChangePct: number | null;
  marketCap: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  rank?: number;
}

async function fetchSectorRow(etf: SectorEtf): Promise<SectorRow> {
  try {
    const quote = (await withRetry(() =>
      withTimeout(yahooFinance.quote(etf.ticker), YAHOO_TIMEOUT_MS, `sector ${etf.ticker}`),
    )) as Record<string, unknown>;
    return {
      ticker: etf.ticker,
      sector: etf.sector,
      emoji: etf.emoji,
      price: asNumber(quote.regularMarketPrice),
      dayChangePct: pctPoints(quote.regularMarketChangePercent as number),
      fiveDayChangePct: pctFromRatio(quote.fiveDayAverageChangePercent as number),
      ytdChangePct:
        pctPoints(quote.ytdReturn as number) ?? pctPoints(quote.fiftyTwoWeekChangePercent as number),
      marketCap: asNumber(quote.marketCap),
      fiftyTwoWeekHigh: asNumber(quote.fiftyTwoWeekHigh),
      fiftyTwoWeekLow: asNumber(quote.fiftyTwoWeekLow),
    };
  } catch {
    // Surface gracefully — partial data is better than aborting the whole call.
    return {
      ticker: etf.ticker,
      sector: etf.sector,
      emoji: etf.emoji,
      price: null,
      dayChangePct: null,
      fiveDayChangePct: null,
      ytdChangePct: null,
      marketCap: null,
      fiftyTwoWeekHigh: null,
      fiftyTwoWeekLow: null,
    };
  }
}

export const sectorPerformanceTool = new DynamicStructuredTool({
  name: 'sector_performance',
  description:
    'Returns a snapshot of the 11 S&P GICS sector ETFs (XLK/XLF/XLE/...) plus SPY/QQQ/IWM benchmarks (free). Use for macro-radar and sector rotation analysis. One call replaces 14 individual yahoo_quote calls.',
  schema: SectorPerformanceSchema,
  func: async (input) => {
    try {
      const targets = input.includeBenchmarks ? [...SECTOR_ETFS, ...BENCHMARKS] : SECTOR_ETFS;
      // Cache 5 min — the 11 ETF quotes don't move fast enough to matter
      // and macro-radar / sector-comparison both call into this.
      const cacheKey = `sector_performance:${input.includeBenchmarks ? 'full' : 'sectors'}`;
      const rows = await memoize(cacheKey, 5 * 60_000, () => Promise.all(targets.map(fetchSectorRow)));

      // Rank sectors by day change (descending). Benchmarks excluded from ranking.
      const sectors = rows.filter((r) => SECTOR_ETFS.some((s) => s.ticker === r.ticker));
      const sortedSectors = [...sectors].sort(
        (a, b) => (b.dayChangePct ?? -Infinity) - (a.dayChangePct ?? -Infinity),
      );
      sortedSectors.forEach((row, idx) => {
        row.rank = idx + 1;
      });

      const benchmarks = rows.filter((r) => BENCHMARKS.some((b) => b.ticker === r.ticker));

      // Risk regime heuristic: spread between Tech (XLK) and Staples (XLP) day change.
      // Tech > Staples by >1pp → risk-on. Staples > Tech by >1pp → risk-off.
      const xlk = sectors.find((s) => s.ticker === 'XLK')?.dayChangePct;
      const xlp = sectors.find((s) => s.ticker === 'XLP')?.dayChangePct;
      let regime: 'risk-on' | 'risk-off' | 'neutral' | 'unknown' = 'unknown';
      if (xlk !== null && xlp !== null && xlk !== undefined && xlp !== undefined) {
        const spread = xlk - xlp;
        regime = spread > 1 ? 'risk-on' : spread < -1 ? 'risk-off' : 'neutral';
      }

      return formatToolResult(
        {
          asOf: new Date().toISOString(),
          regime,
          regimeHint:
            regime === 'risk-on'
              ? 'Tech leading defensives → growth/momentum favored'
              : regime === 'risk-off'
                ? 'Staples leading tech → value/defensive favored'
                : regime === 'neutral'
                  ? 'No clear sector rotation'
                  : 'Insufficient data to judge regime',
          sectors: sortedSectors,
          benchmarks,
        },
        [
          'https://finance.yahoo.com/sectors',
          'https://www.spdrs.com/en/etfs/select-sector-spdrs',
        ],
      );
    } catch (error) {
      return formatToolResult(
        { error: `Sector performance fetch failed: ${error instanceof Error ? error.message : String(error)}` },
        [],
      );
    }
  },
});
