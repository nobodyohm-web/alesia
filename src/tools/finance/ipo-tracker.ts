/**
 * IPO Tracker Tool — Free IPO data via SEC EDGAR + Nasdaq calendar.
 * No API key required. Uses safeFetch (retry + 5xx backoff) on every external call.
 */
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { safeFetch } from '../../utils/retry.js';

export const IPO_TRACKER_DESCRIPTION = `
Tracks upcoming and recent IPOs using free public data sources (SEC EDGAR, Nasdaq).
No API key required. Provides: company name, ticker, expected date, exchange, price range, and filing status.
`.trim();

const IpoSearchSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe("Search query for IPOs, e.g. 'upcoming IPOs this month', 'recent tech IPOs', 'space IPOs 2026'"),
});

const SEC_EDGAR_S1_URL = 'https://efts.sec.gov/LATEST/search-index';
const SEC_EDGAR_LISTING_URL = 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&type=S-1';
const NASDAQ_IPO_CALENDAR_URL = 'https://www.nasdaq.com/market-activity/ipos';
const FETCH_OPTS = { maxRetries: 1, baseDelayMs: 500, timeoutMs: 10_000 };

interface SecS1Hit {
  _source?: {
    entity_name?: unknown;
    display_names?: unknown;
    file_date?: unknown;
    form_type?: unknown;
    file_num?: unknown;
  };
}

interface NasdaqIpoRow {
  companyName?: unknown;
  proposedTickerSymbol?: unknown;
  proposedExchange?: unknown;
  proposedSharePrice?: unknown;
  expectedPriceDate?: unknown;
  sharesOffered?: unknown;
}

async function fetchSecS1(): Promise<Record<string, unknown>[]> {
  try {
    const url =
      `${SEC_EDGAR_S1_URL}?q=%22S-1%22&forms=S-1` +
      `&dateRange=custom&startdt=${getDateDaysAgo(60)}&enddt=${getToday()}`;
    const resp = await safeFetch(
      url,
      {
        headers: {
          'User-Agent': 'Alesia Financial Agent contact@alesia.ai',
          Accept: 'application/json',
        },
      },
      FETCH_OPTS,
    );
    if (!resp.ok) return [];
    const data = (await resp.json()) as Record<string, unknown>;
    const hits = ((data.hits as Record<string, unknown>)?.hits as SecS1Hit[] | undefined) ?? [];
    return hits.slice(0, 15).map((hit) => ({
      source: 'SEC EDGAR (S-1 Filing)',
      company: hit._source?.entity_name ?? hit._source?.display_names,
      filingDate: hit._source?.file_date,
      formType: hit._source?.form_type,
      fileNumber: hit._source?.file_num,
    }));
  } catch {
    return [];
  }
}

async function fetchNasdaqIpoCalendar(): Promise<Record<string, unknown>[]> {
  try {
    const resp = await safeFetch(
      `https://api.nasdaq.com/api/ipo/calendar?date=${getToday()}`,
      { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } },
      FETCH_OPTS,
    );
    if (!resp.ok) return [];
    const json = (await resp.json()) as Record<string, unknown>;
    const data = json.data as Record<string, unknown> | undefined;
    if (!data) return [];
    const upcoming = data.upcoming as Record<string, unknown> | undefined;
    const rows = (upcoming?.rows as NasdaqIpoRow[] | undefined) ?? [];
    return rows.slice(0, 15).map((row) => ({
      source: 'Nasdaq IPO Calendar',
      company: row.companyName,
      ticker: row.proposedTickerSymbol,
      exchange: row.proposedExchange,
      priceRange: row.proposedSharePrice,
      expectedDate: row.expectedPriceDate,
      sharesOffered: row.sharesOffered,
    }));
  } catch {
    return [];
  }
}

export const ipoTrackerTool = new DynamicStructuredTool({
  name: 'ipo_tracker',
  description:
    'Searches for upcoming, recent, or filed IPOs. Returns company names, expected dates, exchanges, price ranges, and filing details. Uses free public sources (SEC EDGAR S-1 + Nasdaq IPO calendar). Use when users ask about upcoming IPOs, new listings, or recent market entries.',
  schema: IpoSearchSchema,
  func: async (input) => {
    const [secResults, nasdaqResults] = await Promise.all([fetchSecS1(), fetchNasdaqIpoCalendar()]);
    const results = [...nasdaqResults, ...secResults];

    if (results.length === 0) {
      return formatToolResult(
        {
          query: input.query,
          message:
            'No IPO data returned from free sources. Use web_search "upcoming IPOs" for the latest manually-curated lists.',
        },
        [SEC_EDGAR_LISTING_URL, NASDAQ_IPO_CALENDAR_URL],
      );
    }

    return formatToolResult(
      { query: input.query, count: results.length, ipos: results },
      [SEC_EDGAR_LISTING_URL, NASDAQ_IPO_CALENDAR_URL],
    );
  },
});

function getToday(): string {
  return new Date().toISOString().split('T')[0];
}

function getDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}
