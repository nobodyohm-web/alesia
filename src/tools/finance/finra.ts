/**
 * FINRA Tool — Short interest and off-exchange volume from the US SRO that
 * produces the data. Free, no API key, primary source (not a scrape).
 *
 * Closes Alesia's short-side blind spot: Yahoo exposes a single point-in-time
 * short ratio and nothing else, so the agent could not answer "is the short
 * crowded", "is short interest building into earnings", or "how much of this
 * ticker prints off-exchange".
 */
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { safeFetch, memoize } from '../../utils/retry.js';
import { TTL_6H } from './utils.js';

const BASE = 'https://api.finra.org/data/group/otcMarket/name';

// FINRA sits behind Cloudflare and drops requests without a browser UA.
const HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

export const SHORT_INTEREST_DESCRIPTION = `
Fetches short-side and off-exchange data from FINRA (free, no API key, official source).

Three modes:
- **short_interest** — bi-monthly consolidated short position per US ticker: current and prior
  short shares, change %, average daily volume, and days-to-cover. The positioning measure.
- **reg_sho** — DAILY short volume vs total volume per reporting facility. A short-selling
  pressure proxy that updates every session, unlike the bi-monthly position above.
- **ats_volume** — weekly ATS ("dark pool") share volume and trade counts per broker (MPID).
  Institutional flow colour available nowhere else in the toolset.

Use short_interest for squeeze setups and crowded-short risk, reg_sho for near-term pressure,
ats_volume to see where a name actually trades. Short interest is published with roughly an
8-day lag and only twice a month — it is a positioning indicator, never a live signal.
`.trim();

const ShortInterestSchema = z.object({
  ticker: z.string().min(1).describe("US ticker symbol, e.g. 'NVDA', 'TSLA', 'GME'"),
  mode: z
    .enum(['short_interest', 'reg_sho', 'ats_volume'])
    .default('short_interest')
    .describe(
      "'short_interest' = bi-monthly short position + days-to-cover (default), 'reg_sho' = daily short volume, 'ats_volume' = weekly dark-pool volume by broker",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe('Number of recent observations to return (1-50). Defaults to 10.'),
});

export const DATASETS = {
  // `daysPerObservation` reflects each dataset's publication cadence: the
  // consolidated file is bi-monthly, Reg SHO is daily (with several reporting
  // facilities per session), the ATS summary is weekly (several firms per week).
  short_interest: {
    name: 'consolidatedShortInterest',
    symbolField: 'symbolCode',
    dateField: 'settlementDate',
    daysPerObservation: 20,
    rowsPerObservation: 1,
    publicationLagDays: 20,
  },
  reg_sho: {
    name: 'regShoDaily',
    symbolField: 'securitiesInformationProcessorSymbolIdentifier',
    dateField: 'tradeReportDate',
    daysPerObservation: 2,
    rowsPerObservation: 6,
    publicationLagDays: 7,
  },
  ats_volume: {
    name: 'weeklySummary',
    symbolField: 'issueSymbolIdentifier',
    dateField: 'weekStartDate',
    daysPerObservation: 8,
    // The ATS summary is published about three weeks after the trading week,
    // so a window sized only on cadence returns nothing at all.
    publicationLagDays: 35,
    rowsPerObservation: 8,
  },
} as const;

interface FinraRow {
  [key: string]: unknown;
}

type Dataset = (typeof DATASETS)[keyof typeof DATASETS];

async function queryFinra(ds: Dataset, ticker: string, limit: number): Promise<FinraRow[]> {
  const url = `${BASE}/${ds.name}`;

  // FINRA returns the OLDEST records first and rejects `sortFields` unless
  // every partition key is supplied with an EQUAL filter. Sorting locally is
  // therefore not enough — without a date floor the window starts in 2020.
  // Bound the query by date instead, then sort what comes back.
  const windowDays = ds.publicationLagDays + limit * ds.daysPerObservation;
  const floor = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const body = JSON.stringify({
    limit: Math.min(limit * ds.rowsPerObservation * 2, 1000),
    compareFilters: [
      { fieldName: ds.symbolField, fieldValue: ticker, compareType: 'EQUAL' },
      { fieldName: ds.dateField, fieldValue: floor.toISOString().slice(0, 10), compareType: 'GTE' },
    ],
  });

  const resp = await safeFetch(url, { method: 'POST', headers: HEADERS, body });
  if (!resp.ok) {
    throw new Error(`FINRA returned HTTP ${resp.status} for ${ds.name}`);
  }
  const json = (await resp.json()) as FinraRow[] | { message?: string } | null;
  // FINRA answers an empty result set with a literal `null` body, not `[]`.
  if (json === null) return [];
  if (!Array.isArray(json)) {
    throw new Error(`FINRA returned an unexpected payload: ${JSON.stringify(json).slice(0, 200)}`);
  }
  return json;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export const shortInterestTool = new DynamicStructuredTool({
  name: 'short_interest',
  description:
    'Short-side and off-exchange data from FINRA (free, no key, official): bi-monthly short interest with days-to-cover, daily Reg SHO short volume, or weekly dark-pool volume by broker. Use for squeeze setups and crowded-short risk.',
  schema: ShortInterestSchema,
  func: async (input) => {
    const ticker = input.ticker.trim().toUpperCase();
    const ds = DATASETS[input.mode];
    const sources = [`https://www.finra.org/finra-data/browse-catalog/equity-short-interest/data`];

    try {
      return await memoize(`finra:${input.mode}:${ticker}:${input.limit}`, TTL_6H, async () => {
        const raw = await queryFinra(ds, ticker, input.limit);
        if (raw.length === 0) {
          return formatToolResult(
            { ticker, mode: input.mode, rows: [], note: `FINRA has no recent ${input.mode} records for ${ticker}. Check the symbol (share classes use a different suffix than Yahoo).` },
            sources,
          );
        }

        const dateOf = (row: FinraRow): string => String(row[ds.dateField] ?? '');
        const sorted = raw.sort((a, b) => dateOf(b).localeCompare(dateOf(a))).slice(0, input.limit);

        // Project only the fields worth spending context on — the raw rows
        // carry a dozen internal FINRA codes each.
        if (input.mode === 'short_interest') {
          const rows = sorted.map((r) => ({
            settlementDate: r.settlementDate ?? null,
            shortShares: num(r.currentShortPositionQuantity),
            priorShortShares: num(r.previousShortPositionQuantity),
            changePercent: num(r.changePercent),
            avgDailyVolume: num(r.averageDailyVolumeQuantity),
            daysToCover: num(r.daysToCoverQuantity),
          }));
          const latest = rows[0];
          const prior = rows[1];
          return formatToolResult(
            {
              ticker,
              mode: input.mode,
              asOf: latest.settlementDate,
              shortShares: latest.shortShares,
              daysToCover: latest.daysToCover,
              changePercent: latest.changePercent,
              trend:
                latest.shortShares !== null && prior?.shortShares
                  ? latest.shortShares > prior.shortShares
                    ? 'building'
                    : 'covering'
                  : null,
              note: 'Bi-monthly settlement data published with ~8 days lag — positioning, not a live signal.',
              history: rows,
            },
            sources,
          );
        }

        if (input.mode === 'reg_sho') {
          // FINRA reports one row per reporting facility per session. The
          // analytically useful figure is the consolidated daily short share,
          // so sum the facilities before trimming to `limit` DAYS (not rows).
          const byDate = new Map<string, { short: number; exempt: number; total: number }>();
          for (const r of raw) {
            const date = String(r.tradeReportDate ?? '');
            if (!date) continue;
            const acc = byDate.get(date) ?? { short: 0, exempt: 0, total: 0 };
            acc.short += num(r.shortParQuantity) ?? 0;
            acc.exempt += num(r.shortExemptParQuantity) ?? 0;
            acc.total += num(r.totalParQuantity) ?? 0;
            byDate.set(date, acc);
          }
          const rows = [...byDate.entries()]
            .sort((a, b) => b[0].localeCompare(a[0]))
            .slice(0, input.limit)
            .map(([date, v]) => ({
              date,
              // FINRA emits fractional share counts on aggregated rows; round
              // so the model is not handed 17524991.404379003 shares.
              shortVolume: Math.round(v.short),
              shortExemptVolume: Math.round(v.exempt),
              totalVolume: Math.round(v.total),
              shortPercent: v.total ? Number(((v.short / v.total) * 100).toFixed(2)) : null,
            }));
          const avgShortPct = rows.length
            ? Number((rows.reduce((s, r) => s + (r.shortPercent ?? 0), 0) / rows.length).toFixed(2))
            : null;
          return formatToolResult(
            {
              ticker,
              mode: input.mode,
              asOf: rows[0]?.date ?? null,
              latestShortPercent: rows[0]?.shortPercent ?? null,
              averageShortPercent: avgShortPct,
              note: 'Daily short volume consolidated across reporting facilities — a selling-pressure proxy, not a position. ~40-50% is typical for a liquid name.',
              rows,
            },
            sources,
          );
        }

        const rows = sorted.map((r) => {
          const shares = num(r.totalWeeklyShareQuantity);
          return {
            weekStart: r.weekStartDate ?? null,
            firm: r.marketParticipantName ?? r.firmName ?? null,
            mpid: r.MPID ?? null,
            shares: shares !== null ? Math.round(shares) : null,
            trades: num(r.totalWeeklyTradeCount),
            notionalUsd: num(r.totalNotionalSum),
          };
        });
        return formatToolResult(
          { ticker, mode: input.mode, asOf: rows[0]?.weekStart ?? null, note: 'Weekly ATS (dark pool) volume per broker.', rows },
          sources,
        );
      });
    } catch (error) {
      return formatToolResult(
        { error: `FINRA ${input.mode} failed for ${ticker}: ${error instanceof Error ? error.message : String(error)}` },
        sources,
      );
    }
  },
});
