/**
 * Analyst Consensus Tool — Extracts Wall Street consensus from Yahoo Finance.
 * Reads recommendationTrend (strongBuy → strongSell) and computes a normalized
 * consensus score (1.0 = STRONG BUY, 5.0 = STRONG SELL).
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
const YAHOO_TIMEOUT_MS = 15_000;

export const ANALYST_CONSENSUS_DESCRIPTION = `
Extracts the Wall Street analyst consensus for a stock from Yahoo Finance (free).
Returns the breakdown (strongBuy / buy / hold / sell / strongSell), the mean rating,
target prices, and a normalized consensus label (STRONG BUY / BUY / HOLD / SELL / STRONG SELL).
`.trim();

const ConsensusSchema = z.object({
  ticker: z.string().min(1).describe("Stock ticker symbol, e.g. 'AAPL', 'TSLA', 'NVDA'"),
});

interface RecommendationRow {
  period?: unknown;
  strongBuy?: unknown;
  buy?: unknown;
  hold?: unknown;
  sell?: unknown;
  strongSell?: unknown;
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value === 'object' && 'raw' in value) {
    const raw = (value as { raw?: unknown }).raw;
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  }
  return 0;
}

function labelForScore(score: number): string {
  if (score <= 1.5) return 'STRONG BUY';
  if (score <= 2.5) return 'BUY';
  if (score <= 3.5) return 'HOLD';
  if (score <= 4.5) return 'SELL';
  return 'STRONG SELL';
}

export const analystConsensusTool = new DynamicStructuredTool({
  name: 'analyst_consensus',
  description:
    'Returns the Wall Street analyst consensus for a ticker (free). Includes the strongBuy/buy/hold/sell/strongSell breakdown, mean rating (1=STRONG BUY → 5=STRONG SELL), target price range, and a normalized verdict label. Use when the user asks "what do analysts think of X" or to enrich a stock report.',
  schema: ConsensusSchema,
  func: async (input) => {
    const ticker = input.ticker.trim().toUpperCase();
    try {
      return await memoize(`analyst_consensus:${ticker}`, 5 * 60_000, async () => {
      const result = await withRetry(() =>
        withTimeout(
          yahooFinance.quoteSummary(ticker, {
            modules: [
              'recommendationTrend' as never,
              'financialData' as never,
              'upgradeDowngradeHistory' as never,
            ],
          }),
          YAHOO_TIMEOUT_MS,
          `analyst_consensus ${ticker}`,
        ),
      );
      const data = result as Record<string, unknown>;

      const recRoot = data.recommendationTrend as Record<string, unknown> | undefined;
      const trend = (recRoot?.trend as RecommendationRow[] | undefined) ?? [];

      // Prefer the most recent period (period === '0m'), fall back to first row.
      const current = trend.find((r) => r.period === '0m') ?? trend[0];
      const strongBuy = current ? asNumber(current.strongBuy) : 0;
      const buy = current ? asNumber(current.buy) : 0;
      const hold = current ? asNumber(current.hold) : 0;
      const sell = current ? asNumber(current.sell) : 0;
      const strongSell = current ? asNumber(current.strongSell) : 0;
      const total = strongBuy + buy + hold + sell + strongSell;

      const weighted =
        strongBuy * 1 + buy * 2 + hold * 3 + sell * 4 + strongSell * 5;
      const meanRating = total > 0 ? weighted / total : 0;
      const verdict = total > 0 ? labelForScore(meanRating) : 'NO COVERAGE';

      const fin = data.financialData as Record<string, unknown> | undefined;
      const targetMean = fin ? asNumber(fin.targetMeanPrice) : 0;
      const targetHigh = fin ? asNumber(fin.targetHighPrice) : 0;
      const targetLow = fin ? asNumber(fin.targetLowPrice) : 0;
      const targetMedian = fin ? asNumber(fin.targetMedianPrice) : 0;
      const numberOfAnalysts = fin ? asNumber(fin.numberOfAnalystOpinions) : 0;
      const currentPrice = fin ? asNumber(fin.currentPrice) : 0;
      const upsidePct =
        currentPrice > 0 && targetMean > 0
          ? ((targetMean - currentPrice) / currentPrice) * 100
          : null;

      const upgradesRoot = data.upgradeDowngradeHistory as Record<string, unknown> | undefined;
      const recentActions = ((upgradesRoot?.history as Array<Record<string, unknown>> | undefined) ?? [])
        .slice(0, 5)
        .map((h) => ({
          firm: h.firm,
          action: h.action,
          fromGrade: h.fromGrade,
          toGrade: h.toGrade,
          epochGradeDate: h.epochGradeDate,
        }));

      // Drop trend rows where every count is zero — Yahoo pads the array with
      // empty periods which only burn tokens.
      const historicalTrend = trend
        .map((row) => {
          const sb = asNumber(row.strongBuy);
          const b = asNumber(row.buy);
          const h = asNumber(row.hold);
          const s = asNumber(row.sell);
          const ss = asNumber(row.strongSell);
          if (sb + b + h + s + ss === 0) return null;
          return { period: row.period, strongBuy: sb, buy: b, hold: h, sell: s, strongSell: ss };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null);

      return formatToolResult(
        {
          ticker,
          verdict,
          meanRating: Number(meanRating.toFixed(2)),
          analystCount: total,
          breakdown: { strongBuy, buy, hold, sell, strongSell },
          historicalTrend,
          priceTargets: {
            current: currentPrice || null,
            mean: targetMean || null,
            median: targetMedian || null,
            high: targetHigh || null,
            low: targetLow || null,
            upsidePct: upsidePct !== null ? Number(upsidePct.toFixed(1)) : null,
            numberOfAnalysts: numberOfAnalysts || null,
          },
          ...(recentActions.length > 0 ? { recentActions } : {}),
        },
        [`https://finance.yahoo.com/quote/${ticker}/analysis`]
      );
      });
    } catch (error) {
      return formatToolResult(
        {
          error: `Analyst consensus failed for ${ticker}: ${error instanceof Error ? error.message : String(error)}`,
        },
        []
      );
    }
  },
});
