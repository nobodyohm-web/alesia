/**
 * Fear & Greed Index Tool — Free crypto market sentiment from alternative.me.
 * Used by crypto-scanner and memecoin-scanner skills as a robust replacement
 * for ad-hoc web_search calls.
 */
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { safeFetch, memoize } from '../../utils/retry.js';

export const FEAR_GREED_DESCRIPTION = `
Fetches the Crypto Fear & Greed Index (0–100) from alternative.me — free, no API key.
0–25 = Extreme Fear, 25–45 = Fear, 45–55 = Neutral, 55–75 = Greed, 75–100 = Extreme Greed.
Use it to gauge crypto market sentiment in scanners and analyses. Returns the latest value
plus an optional history (limit ≤ 30 days) for trend analysis.
`.trim();

const FearGreedSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(30)
    .default(1)
    .describe('Number of historical days to include (1–30). 1 returns only the most recent value.'),
});

interface FearGreedRow {
  value: string;
  value_classification: string;
  timestamp: string;
  time_until_update?: string;
}

interface FearGreedResponse {
  data?: FearGreedRow[];
  metadata?: { error: string | null };
}

function classify(score: number): string {
  if (score < 25) return 'Extreme Fear';
  if (score < 45) return 'Fear';
  if (score < 55) return 'Neutral';
  if (score < 75) return 'Greed';
  return 'Extreme Greed';
}

function emoji(score: number): string {
  if (score < 25) return '🔴🔴';
  if (score < 45) return '🔴';
  if (score < 55) return '🟡';
  if (score < 75) return '🟢';
  return '🟢🟢';
}

export const fearGreedTool = new DynamicStructuredTool({
  name: 'fear_greed_index',
  description:
    'Returns the Crypto Fear & Greed Index (0–100) from alternative.me. Free, no API key. Use to gauge market sentiment in crypto/memecoin analyses.',
  schema: FearGreedSchema,
  func: async (input) => {
    try {
      const url = `https://api.alternative.me/fng/?limit=${input.limit}&format=json`;
      // Index updates once a day → cache aggressively (15 min covers any
      // multi-skill run where crypto-scanner + memecoin-scanner + macro-radar
      // all read the same value).
      return await memoize(`fear_greed:${input.limit}`, 15 * 60_000, async () => {
      const resp = await safeFetch(url, { method: 'GET' });
      if (!resp.ok) {
        return formatToolResult({ error: `Fear & Greed API returned HTTP ${resp.status}` }, [url]);
      }
      const json = (await resp.json()) as FearGreedResponse;
      if (json.metadata?.error) {
        return formatToolResult({ error: `Fear & Greed API error: ${json.metadata.error}` }, [url]);
      }

      const rows = (json.data ?? []).map((row) => {
        const score = Number.parseInt(row.value, 10);
        const ts = Number.parseInt(row.timestamp, 10);
        return {
          score: Number.isFinite(score) ? score : null,
          classification: row.value_classification,
          date: Number.isFinite(ts) ? new Date(ts * 1000).toISOString().slice(0, 10) : null,
        };
      });

      const latest = rows[0];
      if (!latest || latest.score === null) {
        return formatToolResult({ error: 'Fear & Greed API returned no data' }, [url]);
      }

      const trend = rows.length > 1 && rows[rows.length - 1].score !== null
        ? (latest.score as number) - (rows[rows.length - 1].score as number)
        : null;

      return formatToolResult(
        {
          score: latest.score,
          classification: classify(latest.score),
          emoji: emoji(latest.score),
          asOf: latest.date,
          trend, // positive = greed rising, negative = fear rising
          history: rows,
          interpretation: latest.score >= 75
            ? 'Market is greedy — consider trimming risk.'
            : latest.score <= 25
              ? 'Market is fearful — contrarian opportunities possible.'
              : 'Sentiment is balanced — follow the technical picture.',
        },
        [url, 'https://alternative.me/crypto/fear-and-greed-index/']
      );
      });
    } catch (error) {
      return formatToolResult(
        { error: `Fear & Greed fetch failed: ${error instanceof Error ? error.message : String(error)}` },
        []
      );
    }
  },
});
