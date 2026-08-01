/**
 * Federal Reserve Tool — Official policy and reference rates from the
 * New York Fed Markets API (markets.newyorkfed.org). Free, no API key.
 *
 * The NY Fed publishes the rates the FOMC actually steers: EFFR (fed funds),
 * SOFR (secured overnight financing), OBFR, plus the current target range.
 * Alesia previously had no source for the policy rate at all — the discount
 * rate underpinning every valuation was left to the model's memory.
 */
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { safeFetch, memoize } from '../../utils/retry.js';
import { TTL_6H } from './utils.js';

const BASE = 'https://markets.newyorkfed.org/api';

export const FED_RATES_DESCRIPTION = `
Fetches official US policy and reference interest rates from the New York Fed (free, no API key).

Returns:
- **EFFR** (Effective Federal Funds Rate) — the rate the FOMC targets, plus the current target range
- **SOFR** (Secured Overnight Financing Rate) — the USD risk-free benchmark, with 30/90/180-day averages
- **OBFR** (Overnight Bank Funding Rate)
- Daily volumes and percentile distributions for each

Use it whenever an analysis needs the actual policy rate: DCF discount rates, the cash
alternative in an equity risk premium, carry costs, or "what has the Fed done lately".
Rates are published each business day for the PREVIOUS session, so expect a one-day lag.
Never state the fed funds rate from memory — call this tool.
`.trim();

const FedRatesSchema = z.object({
  history: z
    .number()
    .int()
    .min(1)
    .max(60)
    .default(1)
    .describe('Number of recent observations per rate (1-60). 1 returns only the latest values.'),
});

interface RefRate {
  effectiveDate?: string;
  type?: string;
  percentRate?: number;
  targetRateFrom?: number;
  targetRateTo?: number;
  volumeInBillions?: number;
  percentPercentile1?: number;
  percentPercentile99?: number;
  average30day?: number;
  average90day?: number;
  average180day?: number;
  index?: number;
}

/** Rates we surface, in the order an analyst reads them. */
const RATE_TYPES = ['EFFR', 'SOFR', 'OBFR'] as const;

async function fetchRate(type: string, count: number): Promise<RefRate[]> {
  // The NY Fed splits its endpoints by collateral: EFFR/OBFR are unsecured,
  // SOFR is secured.
  const group = type === 'SOFR' ? 'secured' : 'unsecured';
  const url = `${BASE}/rates/${group}/${type.toLowerCase()}/last/${count}.json`;
  const resp = await safeFetch(url, { method: 'GET' });
  if (!resp.ok) {
    throw new Error(`NY Fed API returned HTTP ${resp.status} for ${type}`);
  }
  const json = (await resp.json()) as { refRates?: RefRate[] };
  return (json.refRates ?? []).filter((r) => r.type === type);
}

export const fedRatesTool = new DynamicStructuredTool({
  name: 'fed_rates',
  description:
    'Official US policy rates from the New York Fed (free, no key): EFFR with the FOMC target range, SOFR with 30/90/180-day averages, and OBFR. Use for discount rates and any statement about Fed policy.',
  schema: FedRatesSchema,
  func: async (input) => {
    const count = input.history;
    const sources = [`${BASE}/rates/all/latest.json`, 'https://www.newyorkfed.org/markets/reference-rates'];
    try {
      // Policy rates change at most once per business day.
      return await memoize(`fed_rates:${count}`, TTL_6H, async () => {
        const results = await Promise.all(
          RATE_TYPES.map(async (type) => {
            try {
              return { type, rows: await fetchRate(type, count) };
            } catch (error) {
              return { type, rows: [], error: error instanceof Error ? error.message : String(error) };
            }
          }),
        );

        const rates: Record<string, unknown> = {};
        for (const { type, rows, error } of results) {
          if (error && rows.length === 0) {
            rates[type] = { error };
            continue;
          }
          const latest = rows[0];
          if (!latest) {
            rates[type] = { error: 'no observation returned' };
            continue;
          }
          rates[type] = {
            rate: latest.percentRate ?? null,
            asOf: latest.effectiveDate ?? null,
            volumeBn: latest.volumeInBillions ?? null,
            range: latest.percentPercentile1 != null && latest.percentPercentile99 != null
              ? { p1: latest.percentPercentile1, p99: latest.percentPercentile99 }
              : null,
            ...(type === 'EFFR' && latest.targetRateFrom != null
              ? { fomcTargetRange: { from: latest.targetRateFrom, to: latest.targetRateTo ?? null } }
              : {}),
            ...(count > 1
              ? { history: rows.map((r) => ({ date: r.effectiveDate, rate: r.percentRate })) }
              : {}),
          };
        }

        // SOFR averages and the compounded index live on a separate "SOFRAI"
        // record; one extra call keeps the term-rate view complete.
        let sofrAverages: Record<string, unknown> | null = null;
        try {
          const resp = await safeFetch(`${BASE}/rates/secured/sofrai/last/1.json`, { method: 'GET' });
          if (resp.ok) {
            const json = (await resp.json()) as { refRates?: RefRate[] };
            const ai = json.refRates?.[0];
            if (ai) {
              sofrAverages = {
                asOf: ai.effectiveDate ?? null,
                avg30day: ai.average30day ?? null,
                avg90day: ai.average90day ?? null,
                avg180day: ai.average180day ?? null,
                index: ai.index ?? null,
              };
            }
          }
        } catch {
          // Averages are a bonus; the core rates above are what matter.
        }

        const effr = rates.EFFR as { rate?: number | null; fomcTargetRange?: { from: number; to: number | null } } | undefined;

        return formatToolResult(
          {
            rates,
            sofrAverages,
            policySummary:
              effr?.rate != null && effr.fomcTargetRange
                ? `Fed funds effective ${effr.rate}% within a ${effr.fomcTargetRange.from}–${effr.fomcTargetRange.to}% target range`
                : null,
            note: 'Published each business day for the previous session — a one-day lag is normal, not stale data.',
          },
          sources,
        );
      });
    } catch (error) {
      return formatToolResult(
        { error: `Fed rates fetch failed: ${error instanceof Error ? error.message : String(error)}` },
        sources,
      );
    }
  },
});
