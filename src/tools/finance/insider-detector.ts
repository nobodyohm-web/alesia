/**
 * Insider Trading Detector — Surfaces material insider buys/sells (>$1M).
 * Uses Yahoo Finance insiderHolders + insiderTransactions modules (free).
 */
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import YahooFinance from 'yahoo-finance2';
import { formatToolResult } from '../types.js';
import { withRetry, withTimeout } from '../../utils/retry.js';

const yahooFinance = new YahooFinance({
  suppressNotices: ['yahooSurvey'],
  validation: { logErrors: false },
});
const YAHOO_TIMEOUT_MS = 15_000;

export const INSIDER_DETECTOR_DESCRIPTION = `
Detects material insider trading activity (buys/sells > $1M) for a stock.
Combines Yahoo Finance insiderHolders + insiderTransactions modules with optional SEC Form 4 web search.
Returns a structured signal: total buy / sell value, top transactions, and a directional verdict
(BULLISH / BEARISH / NEUTRAL). Free, no API key required.
`.trim();

const InsiderSchema = z.object({
  ticker: z.string().min(1).describe("Stock ticker symbol, e.g. 'AAPL', 'TSLA', 'FLY'"),
  materialThresholdUsd: z
    .number()
    .nonnegative()
    .default(1_000_000)
    .describe('Minimum USD value for a transaction to be flagged as material. Defaults to 1M.'),
});

interface InsiderTransaction {
  filerName?: unknown;
  filerRelation?: unknown;
  transactionText?: unknown;
  shares?: { raw?: number } | unknown;
  value?: { raw?: number } | unknown;
  startDate?: { fmt?: string } | unknown;
  moneyText?: unknown;
}

function readRaw(field: unknown): number | null {
  if (field && typeof field === 'object' && 'raw' in field) {
    const v = (field as { raw?: unknown }).raw;
    return typeof v === 'number' ? v : null;
  }
  return typeof field === 'number' ? field : null;
}

function readFmt(field: unknown): string | null {
  if (field && typeof field === 'object' && 'fmt' in field) {
    const v = (field as { fmt?: unknown }).fmt;
    return typeof v === 'string' ? v : null;
  }
  return typeof field === 'string' ? field : null;
}

export const insiderDetectorTool = new DynamicStructuredTool({
  name: 'insider_detector',
  description:
    'Detects material insider buys/sells (default >$1M) for a ticker. Returns aggregated buy/sell totals, top transactions, and a BULLISH/BEARISH/NEUTRAL verdict. Use when the user asks about insider activity, Form 4 filings, or to enrich a stock report.',
  schema: InsiderSchema,
  func: async (input) => {
    try {
      const ticker = input.ticker.trim().toUpperCase();
      const threshold = input.materialThresholdUsd;

      const result = await withRetry(() =>
        withTimeout(
          yahooFinance.quoteSummary(ticker, {
            modules: ['insiderHolders' as never, 'insiderTransactions' as never, 'netSharePurchaseActivity' as never],
          }),
          YAHOO_TIMEOUT_MS,
          `insider_detector ${ticker}`,
        ),
      );
      const data = result as Record<string, unknown>;

      const transactionsRoot = data.insiderTransactions as Record<string, unknown> | undefined;
      const txList = (transactionsRoot?.transactions as InsiderTransaction[] | undefined) ?? [];

      const holdersRoot = data.insiderHolders as Record<string, unknown> | undefined;
      const holders = (holdersRoot?.holders as Array<Record<string, unknown>> | undefined) ?? [];

      const netActivity = data.netSharePurchaseActivity as Record<string, unknown> | undefined;

      let buyValue = 0;
      let sellValue = 0;
      const materialTransactions: Array<Record<string, unknown>> = [];

      for (const tx of txList) {
        const value = readRaw(tx.value);
        const shares = readRaw(tx.shares);
        const text = typeof tx.transactionText === 'string' ? tx.transactionText : '';
        const isBuy = /buy|purchase/i.test(text);
        const isSell = /sale|sell|disposition/i.test(text);

        if (typeof value === 'number') {
          if (isBuy) buyValue += value;
          else if (isSell) sellValue += value;
        }

        if (typeof value === 'number' && Math.abs(value) >= threshold) {
          materialTransactions.push({
            filer: tx.filerName,
            relation: tx.filerRelation,
            action: text,
            shares,
            valueUsd: value,
            date: readFmt(tx.startDate),
          });
        }
      }

      const netUsd = buyValue - sellValue;
      let verdict: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
      if (netUsd >= threshold) verdict = 'BULLISH';
      else if (netUsd <= -threshold) verdict = 'BEARISH';
      else verdict = 'NEUTRAL';

      const topHolders = holders.slice(0, 5).map((h) => ({
        name: h.name,
        relation: h.relation,
        position: readRaw(h.positionDirect) ?? readRaw(h.positionIndirect),
        latestTransaction: readFmt(h.latestTransDate),
      }));

      const payload: Record<string, unknown> = {
        ticker,
        verdict,
        materialThresholdUsd: threshold,
        totals: {
          buysUsd: buyValue,
          sellsUsd: sellValue,
          netUsd,
          transactionCount: txList.length,
          materialCount: materialTransactions.length,
        },
      };
      if (materialTransactions.length > 0) {
        payload.materialTransactions = materialTransactions.slice(0, 10);
      }
      if (topHolders.length > 0) {
        payload.topHolders = topHolders;
      }
      if (netActivity) {
        payload.netSharePurchaseActivity = {
          period: netActivity.period,
          buyInfoCount: netActivity.buyInfoCount,
          buyInfoShares: readRaw(netActivity.buyInfoShares),
          sellInfoCount: netActivity.sellInfoCount,
          sellInfoShares: readRaw(netActivity.sellInfoShares),
          netInfoCount: netActivity.netInfoCount,
          netInfoShares: readRaw(netActivity.netInfoShares),
        };
      }
      payload.hint =
        `For full Form 4 detail, follow up with web_search "SEC Form 4 ${ticker}" or rss_intelligence mode=company.`;

      return formatToolResult(
        payload,
        [
          `https://finance.yahoo.com/quote/${ticker}/insider-transactions`,
          `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${ticker}&type=4&dateb=&owner=include&count=40`,
        ]
      );
    } catch (error) {
      return formatToolResult(
        {
          error: `Insider detector failed for ${input.ticker}: ${error instanceof Error ? error.message : String(error)}`,
        },
        []
      );
    }
  },
});
