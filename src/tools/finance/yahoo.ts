/**
 * Yahoo Finance Tools — Free stock data (no API key required).
 * Uses yahoo-finance2 v3 (requires class instantiation).
 * All tools wrapped with try/catch + retry for production resilience.
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

// Hard timeout for every Yahoo SDK call. Yahoo-finance2 doesn't accept an
// AbortSignal, so a stuck upstream would otherwise block the whole agent loop.
const YAHOO_TIMEOUT_MS = 15_000;
const yf = <T>(call: () => Promise<T>, label: string): Promise<T> =>
  withRetry(() => withTimeout(call(), YAHOO_TIMEOUT_MS, label));

// Project an unknown blob down to a fixed allow-list of fields. Drops anything
// undefined/null so the JSON envelope sent to the LLM stays compact.
function pickDefined(
  obj: unknown,
  fields: readonly string[],
): Record<string, unknown> {
  if (!obj || typeof obj !== 'object') return {};
  const src = obj as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = src[f];
    if (v !== undefined && v !== null) out[f] = v;
  }
  return out;
}

export const YAHOO_FINANCE_DESCRIPTION = `
Fetches free stock data from Yahoo Finance. Use as a fallback or complement to the financial_search tool.
Provides: real-time quotes, historical prices, key statistics, income statements, balance sheets, and cash flow statements.
No API key required. Supports all tickers listed on major exchanges worldwide.
`.trim();

// ─── Schemas ────────────────────────────────────────────────────────────────

const TickerSchema = z.object({
  ticker: z.string().min(1).describe("Stock ticker symbol, e.g. 'AAPL', 'FLY', 'TSLA'"),
});

const HistoricalSchema = z.object({
  ticker: z.string().min(1).describe("Stock ticker symbol, e.g. 'AAPL'"),
  period: z.enum(['1mo', '3mo', '6mo', '1y', '2y', '5y', 'max']).default('1y')
    .describe("Time period. Defaults to '1y'."),
  interval: z.enum(['1d', '1wk', '1mo']).default('1d')
    .describe("Data interval. Defaults to '1d'."),
});

const FinancialsSchema = z.object({
  ticker: z.string().min(1).describe("Stock ticker symbol, e.g. 'AAPL'"),
  statement: z.enum(['income', 'balance', 'cashflow']).default('income')
    .describe("Statement type: 'income', 'balance', or 'cashflow'"),
  frequency: z.enum(['annual', 'quarterly']).default('annual')
    .describe("Frequency: 'annual' or 'quarterly'"),
});

// ─── Tools ──────────────────────────────────────────────────────────────────

export const yahooQuoteTool = new DynamicStructuredTool({
  name: 'yahoo_quote',
  description:
    'Fetches real-time quote from Yahoo Finance (free). Returns price, market cap, P/E, EPS, 52-week range, volume, moving averages.',
  schema: TickerSchema,
  func: async (input) => {
    try {
      const ticker = input.ticker.trim().toUpperCase();
      const quote = (await yf(() => yahooFinance.quote(ticker), `yahoo.quote ${ticker}`)) as Record<string, unknown>;
      return formatToolResult({
        symbol: quote.symbol,
        name: quote.shortName || quote.longName,
        price: quote.regularMarketPrice,
        previousClose: quote.regularMarketPreviousClose,
        open: quote.regularMarketOpen,
        dayHigh: quote.regularMarketDayHigh,
        dayLow: quote.regularMarketDayLow,
        volume: quote.regularMarketVolume,
        marketCap: quote.marketCap,
        trailingPE: quote.trailingPE,
        forwardPE: quote.forwardPE,
        eps: quote.epsTrailingTwelveMonths,
        fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh,
        fiftyTwoWeekLow: quote.fiftyTwoWeekLow,
        fiftyDayAverage: quote.fiftyDayAverage,
        twoHundredDayAverage: quote.twoHundredDayAverage,
        dividendYield: quote.dividendYield,
        exchange: quote.exchange,
      }, [`https://finance.yahoo.com/quote/${ticker}`]);
    } catch (error) {
      return formatToolResult({ error: `Yahoo quote failed for ${input.ticker}: ${error instanceof Error ? error.message : String(error)}` }, []);
    }
  },
});

// Map period → max candles to retain. The _summary block (firstClose, lastClose,
// % change, MA50, MA200) is computed from the FULL fetched series before slicing,
// so we can keep the candle tail compact without losing analytical fidelity.
// CLAUDE.md target: ~1.5K tokens, which forces us to truncate the candle array.
const PERIOD_MONTHS: Record<string, number> = { '1mo': 1, '3mo': 3, '6mo': 6, '1y': 12, '2y': 24, '5y': 60, 'max': 600 };
const PERIOD_MAX_CANDLES: Record<string, number> = {
  // ~30 daily / ~22 weekly / ~12 monthly bars cover any short scan
  '1mo': 30, '3mo': 65, '6mo': 60, '1y': 60, '2y': 60, '5y': 60, 'max': 60,
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Drop the placeholder bars Yahoo appends for the in-progress period.
 *
 * Yahoo returns a candle whose OHLCV fields are all `null` for the current,
 * not-yet-closed period — always on monthly data, and on daily/weekly before
 * the session opens. `Number(null)` is `0` and `Number.isFinite(0)` is `true`,
 * so coercing before filtering keeps that bar and reports a close of $0, a
 * -100% move and a period low of $0.
 */
export function dropIncompleteBars(
  quotes: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return quotes.filter((q) => isFiniteNumber(q.close));
}

/**
 * Build the price summary from a series of candles.
 *
 * @param rawQuotes - Candles as returned by `yahooFinance.chart`
 * @returns The summary and the candles it was derived from, or undefined when
 *   fewer than two usable candles remain
 */
export function summarizeQuotes(
  rawQuotes: Array<Record<string, unknown>>,
  period: string,
  interval: string,
): { summary?: Record<string, unknown>; quotes: Array<Record<string, unknown>> } {
  const quotes = dropIncompleteBars(rawQuotes);
  if (quotes.length < 2) {
    return { quotes };
  }

  const fullCloses = quotes.map((q) => q.close as number);
  // Same trap as `close`: a null high/low would coerce to a finite 0.
  const fullHighs = quotes.map((q) => q.high).filter(isFiniteNumber);
  const fullLows = quotes.map((q) => q.low).filter(isFiniteNumber);
  const firstClose = fullCloses[0];
  const lastClose = fullCloses[fullCloses.length - 1];
  const high = fullHighs.length ? Math.max(...fullHighs) : null;
  const low = fullLows.length ? Math.min(...fullLows) : null;
  const pctChange = firstClose !== 0 ? ((lastClose - firstClose) / firstClose) * 100 : null;
  const ma50 =
    fullCloses.length >= 50 ? fullCloses.slice(-50).reduce((a, b) => a + b, 0) / 50 : null;
  const ma200 =
    fullCloses.length >= 200 ? fullCloses.slice(-200).reduce((a, b) => a + b, 0) / 200 : null;

  return {
    quotes,
    summary: {
      period,
      interval,
      fetchedCount: quotes.length,
      firstDate: quotes[0].date,
      lastDate: quotes[quotes.length - 1].date,
      firstClose,
      lastClose,
      percentChange: pctChange !== null ? Number(pctChange.toFixed(2)) : null,
      periodHigh: high,
      periodLow: low,
      ma50: ma50 !== null ? Number(ma50.toFixed(2)) : null,
      ma200: ma200 !== null ? Number(ma200.toFixed(2)) : null,
    },
  };
}

export const yahooHistoricalTool = new DynamicStructuredTool({
  name: 'yahoo_historical',
  description:
    'Fetches historical OHLCV price data from Yahoo Finance (free). Returns daily/weekly/monthly candlesticks. For 1y period returns ~252 daily candles (full year, suitable for backtest + 200-day MA).',
  schema: HistoricalSchema,
  func: async (input) => {
    try {
      const ticker = input.ticker.trim().toUpperCase();
      const now = new Date();
      const months = PERIOD_MONTHS[input.period] || 12;
      const startDate = new Date(now);
      startDate.setMonth(startDate.getMonth() - months);

      const result = (await yf(
        () => yahooFinance.chart(ticker, {
          period1: startDate.toISOString().split('T')[0],
          interval: input.interval as '1d' | '1wk' | '1mo',
        }),
        `yahoo.chart ${ticker}`,
      )) as unknown as Record<string, unknown>;

      const rawQuotes = (result.quotes || []) as Array<Record<string, unknown>>;
      const maxCandles = PERIOD_MAX_CANDLES[input.period] ?? 60;

      // The summary is computed on the FULL usable series so MA200 / period
      // highs don't degrade when the candle array is truncated for token reasons.
      const { summary, quotes } = summarizeQuotes(rawQuotes, input.period, input.interval);

      const candles = quotes.slice(-maxCandles).map((q) => ({
        date: q.date, open: q.open, high: q.high, low: q.low, close: q.close, volume: q.volume,
      }));

      return formatToolResult(
        summary ? { _summary: summary, candles } : { candles },
        [`https://finance.yahoo.com/quote/${ticker}/history`]
      );
    } catch (error) {
      return formatToolResult({ error: `Yahoo historical failed for ${input.ticker}: ${error instanceof Error ? error.message : String(error)}` }, []);
    }
  },
});

// Field projections per statement type. Pulled from fundamentalsTimeSeries
// since the legacy quoteSummary modules (incomeStatementHistory, balanceSheetHistory,
// cashflowStatementHistory) have been returning empty payloads since Nov 2024.
const STATEMENT_FIELDS: Record<'income' | 'balance' | 'cashflow', readonly string[]> = {
  income: [
    'date', 'totalRevenue', 'costOfRevenue', 'grossProfit', 'operatingIncome',
    'EBIT', 'EBITDA', 'normalizedEBITDA', 'netIncome', 'netIncomeFromContinuingOperations',
    'basicEPS', 'dilutedEPS', 'researchAndDevelopment', 'sellingGeneralAndAdministration',
    'taxProvision', 'interestExpense',
  ],
  balance: [
    'date', 'totalAssets', 'totalLiabilitiesNetMinorityInterest', 'stockholdersEquity',
    'currentAssets', 'currentLiabilities', 'cashAndCashEquivalents', 'cashCashEquivalentsAndShortTermInvestments',
    'totalDebt', 'longTermDebt', 'shortTermDebt', 'inventory', 'accountsReceivable',
    'retainedEarnings', 'workingCapital', 'shareIssued', 'ordinarySharesNumber',
  ],
  cashflow: [
    'date', 'operatingCashFlow', 'investingCashFlow', 'financingCashFlow',
    'freeCashFlow', 'capitalExpenditure', 'changeInCashSupplementalAsReported',
    'repurchaseOfCapitalStock', 'cashDividendsPaid', 'depreciationAndAmortization',
    'stockBasedCompensation', 'changeInWorkingCapital',
  ],
};

function projectStatementEntry(entry: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (entry[f] !== undefined && entry[f] !== null) out[f] = entry[f];
  }
  return out;
}

export const yahooFinancialsTool = new DynamicStructuredTool({
  name: 'yahoo_financials',
  description:
    'Fetches income statements, balance sheets, or cash flow statements from Yahoo Finance (free). Multi-year data via fundamentalsTimeSeries (the legacy quoteSummary modules are broken since Nov 2024).',
  schema: FinancialsSchema,
  func: async (input) => {
    try {
      const ticker = input.ticker.trim().toUpperCase();
      const fields = STATEMENT_FIELDS[input.statement];

      // Pull last 4 years (annual) or last 8 quarters of data
      const lookbackYears = input.frequency === 'quarterly' ? 2 : 4;
      const startDate = new Date();
      startDate.setFullYear(startDate.getFullYear() - lookbackYears);

      const moduleArg = (input.statement === 'income'
        ? 'financials'
        : input.statement === 'balance'
          ? 'balance-sheet'
          : 'cash-flow') as 'financials' | 'balance-sheet' | 'cash-flow';

      const raw = await yf(
        () => yahooFinance.fundamentalsTimeSeries(ticker, {
          period1: startDate.toISOString().split('T')[0],
          module: moduleArg,
          type: input.frequency,
        }),
        `yahoo.fundamentals ${ticker} ${moduleArg}`,
      );
      const entries = (raw as Record<string, unknown>[]) ?? [];
      const projected = entries
        .filter((e) => e && typeof e === 'object')
        .map((e) => projectStatementEntry(e, fields))
        .sort((a, b) => {
          const da = new Date(a.date as string).getTime();
          const db = new Date(b.date as string).getTime();
          return db - da; // most recent first
        });

      return formatToolResult(
        { statement: input.statement, frequency: input.frequency, count: projected.length, entries: projected },
        [`https://finance.yahoo.com/quote/${ticker}/financials`]
      );
    } catch (error) {
      return formatToolResult({ error: `Yahoo financials failed for ${input.ticker}: ${error instanceof Error ? error.message : String(error)}` }, []);
    }
  },
});

// Projection: defaultKeyStatistics + financialData → only the fields scoring
// frameworks actually consume (Piotroski, Altman, multi-factor, master-analysis).
// Keeps the tool result well under the ~1k-token budget defined in CLAUDE.md.
const KEY_STATS_FIELDS = [
  // Valuation
  'trailingPE', 'forwardPE', 'pegRatio', 'priceToBook', 'priceToSalesTrailing12Months',
  'enterpriseToEbitda', 'enterpriseToRevenue', 'enterpriseValue',
  // Profitability / quality
  'returnOnEquity', 'returnOnAssets', 'profitMargins', 'operatingMargins',
  'grossMargins', 'ebitdaMargins',
  // Growth
  'revenueGrowth', 'earningsGrowth', 'earningsQuarterlyGrowth',
  // Balance sheet
  'totalCash', 'totalDebt', 'debtToEquity', 'currentRatio', 'quickRatio',
  'totalRevenue', 'ebitda', 'totalCashPerShare', 'bookValue',
  // Per-share
  'trailingEps', 'forwardEps', 'sharesOutstanding', 'floatShares',
  // Recommendations / targets
  'targetMeanPrice', 'targetMedianPrice', 'targetHighPrice', 'targetLowPrice',
  'numberOfAnalystOpinions', 'recommendationKey', 'recommendationMean', 'currentPrice',
  // Misc
  'beta', 'shortRatio', 'shortPercentOfFloat', 'heldPercentInsiders', 'heldPercentInstitutions',
  '52WeekChange', 'SandP52WeekChange',
] as const;

export const yahooKeyStatsTool = new DynamicStructuredTool({
  name: 'yahoo_key_stats',
  description:
    'Fetches key statistics and valuation metrics from Yahoo Finance (free). Returns P/E, PEG, P/B, EV/EBITDA, margins, ROE, debt ratios.',
  schema: TickerSchema,
  func: async (input) => {
    try {
      const ticker = input.ticker.trim().toUpperCase();
      const result = await yf(
        () => yahooFinance.quoteSummary(ticker, { modules: ['defaultKeyStatistics' as never, 'financialData' as never] }),
        `yahoo.keyStats ${ticker}`,
      );
      const root = result as Record<string, unknown>;
      const combined = {
        ...pickDefined(root.defaultKeyStatistics, KEY_STATS_FIELDS),
        ...pickDefined(root.financialData, KEY_STATS_FIELDS),
      };
      return formatToolResult(combined, [`https://finance.yahoo.com/quote/${ticker}/key-statistics`]);
    } catch (error) {
      return formatToolResult({ error: `Yahoo key stats failed for ${input.ticker}: ${error instanceof Error ? error.message : String(error)}` }, []);
    }
  },
});

/**
 * Essential financial fields to extract from fundamentalsTimeSeries.
 * The raw API returns 152+ fields per entry — we keep only what matters for analysis.
 */
const ESSENTIAL_FIELDS = [
  'date', 'totalRevenue', 'netIncome', 'grossProfit', 'operatingIncome',
  'totalAssets', 'totalDebt', 'cashAndCashEquivalents',
  'freeCashFlow', 'operatingCashFlow', 'capitalExpenditure',
  'EBITDA', 'normalizedEBITDA', 'basicEPS', 'dilutedEPS',
  'totalLiabilitiesNetMinorityInterest', 'stockholdersEquity',
  'currentAssets', 'currentLiabilities',
] as const;

/**
 * Extract only essential fields from a fundamentalsTimeSeries entry and compute derived metrics.
 */
function compactFinancialEntry(entry: Record<string, unknown>): Record<string, unknown> {
  const compact: Record<string, unknown> = {};
  for (const field of ESSENTIAL_FIELDS) {
    if (entry[field] !== undefined && entry[field] !== null) {
      compact[field] = entry[field];
    }
  }
  // Compute derived margins if data is available
  const rev = Number(compact.totalRevenue) || 0;
  if (rev > 0) {
    if (compact.grossProfit) compact.grossMargin = `${((Number(compact.grossProfit) / rev) * 100).toFixed(1)}%`;
    if (compact.netIncome) compact.netMargin = `${((Number(compact.netIncome) / rev) * 100).toFixed(1)}%`;
    if (compact.operatingIncome) compact.operatingMargin = `${((Number(compact.operatingIncome) / rev) * 100).toFixed(1)}%`;
  }
  return compact;
}

/**
 * Compact an array of financial entries and compute YoY growth rates.
 */
function compactFinancials(entries: Record<string, unknown>[]): Record<string, unknown>[] {
  if (!entries || entries.length === 0) return [];
  // Sort by date ascending
  const sorted = [...entries].sort((a, b) => {
    const da = new Date(a.date as string).getTime();
    const db = new Date(b.date as string).getTime();
    return da - db;
  });
  const compacted = sorted.map(compactFinancialEntry);
  // Compute YoY revenue growth
  for (let i = 1; i < compacted.length; i++) {
    const prev = Number(compacted[i - 1].totalRevenue) || 0;
    const curr = Number(compacted[i].totalRevenue) || 0;
    if (prev > 0) {
      compacted[i].revenueGrowthYoY = `${(((curr - prev) / prev) * 100).toFixed(1)}%`;
    } else if (curr > 0) {
      compacted[i].revenueGrowthYoY = 'N/A→Revenue (infinite growth)';
    }
  }
  return compacted;
}

/**
 * Yahoo Summary — Batch tool that fetches quote + key stats + full financial statements.
 * Uses fundamentalsTimeSeries (new API) for statements since quoteSummary modules
 * (balanceSheetHistory, incomeStatementHistory, etc.) are broken since Nov 2024.
 * Data is compacted to ~15 essential fields per entry to avoid overwhelming the LLM context.
 */
// Field allow-lists for each quoteSummary module surfaced by yahoo_summary.
// Combined with project() these keep the tool result under the 2k-token
// budget defined in CLAUDE.md while preserving everything the scoring
// frameworks (Piotroski, Altman, multi-factor, DCF) actually read.
const PRICE_FIELDS = [
  'symbol', 'shortName', 'longName', 'currency', 'exchange', 'marketState',
  'regularMarketPrice', 'regularMarketChange', 'regularMarketChangePercent',
  'regularMarketOpen', 'regularMarketDayHigh', 'regularMarketDayLow',
  'regularMarketPreviousClose', 'regularMarketVolume', 'marketCap',
] as const;
const SUMMARY_DETAIL_FIELDS = [
  'previousClose', 'open', 'dayHigh', 'dayLow', 'volume', 'averageVolume', 'averageVolume10days',
  'fiftyTwoWeekHigh', 'fiftyTwoWeekLow', 'fiftyDayAverage', 'twoHundredDayAverage',
  'trailingPE', 'forwardPE', 'priceToSalesTrailing12Months',
  'marketCap', 'beta', 'dividendYield', 'dividendRate', 'trailingAnnualDividendYield',
  'payoutRatio', 'fiveYearAvgDividendYield', 'exDividendDate',
] as const;

interface EarningsHistoryRow {
  quarter?: unknown;
  epsActual?: { raw?: number } | unknown;
  epsEstimate?: { raw?: number } | unknown;
  epsDifference?: { raw?: number } | unknown;
  surprisePercent?: { raw?: number } | unknown;
}
interface RecommendationTrendRow {
  period?: unknown;
  strongBuy?: unknown;
  buy?: unknown;
  hold?: unknown;
  sell?: unknown;
  strongSell?: unknown;
}
interface InsiderHolderRow {
  name?: unknown;
  relation?: unknown;
  positionDirect?: { raw?: number } | unknown;
  positionIndirect?: { raw?: number } | unknown;
  latestTransDate?: { fmt?: string } | unknown;
  transactionDescription?: unknown;
}

function rawNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v && typeof v === 'object' && 'raw' in v) {
    const n = (v as { raw?: unknown }).raw;
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
  }
  return null;
}
function rawFmt(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && 'fmt' in v) {
    const s = (v as { fmt?: unknown }).fmt;
    return typeof s === 'string' ? s : null;
  }
  return null;
}

export const yahooSummaryTool = new DynamicStructuredTool({
  name: 'yahoo_summary',
  description:
    'PREFERRED: Fetches ALL financial data for a stock in ONE call (free). Returns quote, key stats, annual & quarterly financials (revenue, margins, FCF, EPS, debt). Use this INSTEAD of calling yahoo_quote + yahoo_key_stats + yahoo_financials separately.',
  schema: TickerSchema,
  func: async (input) => {
    const ticker = input.ticker.trim().toUpperCase();
    try {
      // 5-minute memo cache: a single skill run typically calls yahoo_summary
      // once per ticker, but cross-skill calls within the same session
      // (e.g. /search → /portfolio) often re-hit the same names.
      return await memoize(`yahoo_summary:${ticker}`, 5 * 60_000, async () => {
        const summaryPromise = yf(
          () => yahooFinance.quoteSummary(ticker, {
            modules: [
              'price' as never,
              'summaryDetail' as never,
              'defaultKeyStatistics' as never,
              'financialData' as never,
              'earningsHistory' as never,
              'recommendationTrend' as never,
              'insiderHolders' as never,
              'assetProfile' as never,
            ],
          }),
          `yahoo.quoteSummary ${ticker}`,
        );

        const threeYearsAgo = new Date();
        threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
        const annualPromise = yf(
          () => yahooFinance.fundamentalsTimeSeries(ticker, {
            period1: threeYearsAgo.toISOString().split('T')[0],
            module: 'all',
            type: 'annual',
          }),
          `yahoo.fundamentals annual ${ticker}`,
        ).catch(() => [] as Record<string, unknown>[]);
        const quarterlyPromise = yf(
          () => yahooFinance.fundamentalsTimeSeries(ticker, {
            period1: threeYearsAgo.toISOString().split('T')[0],
            module: 'all',
            type: 'quarterly',
          }),
          `yahoo.fundamentals quarterly ${ticker}`,
        ).catch(() => [] as Record<string, unknown>[]);

        const [summaryResult, annualData, quarterlyData] = await Promise.all([
          summaryPromise,
          annualPromise,
          quarterlyPromise,
        ]);

        const data = summaryResult as Record<string, unknown>;

        const annualCompact = compactFinancials(annualData as Record<string, unknown>[]);
        const quarterlyCompact = compactFinancials(
          (quarterlyData as Record<string, unknown>[]).slice(-4),
        );

        // Project each quoteSummary module to its essential fields. The raw
        // objects carry hundreds of nested {raw,fmt,longFmt} blobs that
        // overwhelm the LLM context with no analytical value.
        const price = pickDefined(data.price, PRICE_FIELDS);
        const summaryDetail = pickDefined(data.summaryDetail, SUMMARY_DETAIL_FIELDS);
        const keyStatistics = {
          ...pickDefined(data.defaultKeyStatistics, KEY_STATS_FIELDS),
          ...pickDefined(data.financialData, KEY_STATS_FIELDS),
        };

        const earningsRoot = data.earningsHistory as { history?: EarningsHistoryRow[] } | undefined;
        const earningsHistory = (earningsRoot?.history ?? [])
          .slice(-4)
          .map((r) => ({
            quarter: rawFmt(r.quarter),
            epsActual: rawNum(r.epsActual),
            epsEstimate: rawNum(r.epsEstimate),
            surprisePct: rawNum(r.surprisePercent),
          }))
          .filter((r) => r.epsActual !== null || r.epsEstimate !== null);

        const recoRoot = data.recommendationTrend as { trend?: RecommendationTrendRow[] } | undefined;
        const recommendations = (recoRoot?.trend ?? [])
          .map((r) => {
            const sb = rawNum(r.strongBuy) ?? 0;
            const b = rawNum(r.buy) ?? 0;
            const h = rawNum(r.hold) ?? 0;
            const s = rawNum(r.sell) ?? 0;
            const ss = rawNum(r.strongSell) ?? 0;
            if (sb + b + h + s + ss === 0) return null;
            return { period: r.period, strongBuy: sb, buy: b, hold: h, sell: s, strongSell: ss };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null);

        const insidersRoot = data.insiderHolders as { holders?: InsiderHolderRow[] } | undefined;
        const insiderHolders = (insidersRoot?.holders ?? []).slice(0, 5).map((h) => ({
          name: h.name,
          relation: h.relation,
          position: rawNum(h.positionDirect) ?? rawNum(h.positionIndirect),
          latestTransaction: rawFmt(h.latestTransDate),
          description: h.transactionDescription,
        }));

        const profile = data.assetProfile as Record<string, unknown> | undefined;
        const assetProfile = profile
          ? {
              sector: profile.sector,
              industry: profile.industry,
              country: profile.country,
              longBusinessSummary:
                typeof profile.longBusinessSummary === 'string'
                  ? (profile.longBusinessSummary as string).slice(0, 500)
                  : profile.longBusinessSummary,
              fullTimeEmployees: profile.fullTimeEmployees,
              website: profile.website,
            }
          : undefined;

        return formatToolResult(
          {
            price,
            summaryDetail,
            keyStatistics,
            earningsHistory,
            recommendations,
            insiderHolders,
            assetProfile,
            annualFinancials: annualCompact,
            quarterlyFinancials: quarterlyCompact,
          },
          [`https://finance.yahoo.com/quote/${ticker}`],
        );
      });
    } catch (error) {
      return formatToolResult({ error: `Yahoo summary failed for ${ticker}: ${error instanceof Error ? error.message : String(error)}` }, []);
    }
  },
});
