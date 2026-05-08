/**
 * Economic Calendar Tool — Free upcoming macro events.
 *
 * Sources: Trading Economics public calendar JSON (no auth) + a Federal Reserve
 * FOMC schedule fallback. Returns the next N high-impact economic events:
 * FOMC meetings, CPI / Core CPI, NFP, GDP, PCE, retail sales, ISM, etc.
 *
 * Used by macro-radar and earnings-calendar to flag volatility windows.
 */
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { safeFetch } from '../../utils/retry.js';

export const ECONOMIC_CALENDAR_DESCRIPTION = `
Returns upcoming high-impact macro events (FOMC, CPI, NFP, GDP, PCE, retail sales) for the
next N days from Trading Economics' public calendar. Free, no API key. Use to flag volatility
windows in macro-radar, sector-comparison, and risk discussions.
`.trim();

const EconomicCalendarSchema = z.object({
  daysAhead: z
    .number()
    .int()
    .min(1)
    .max(60)
    .default(14)
    .describe('Number of days to look ahead (1–60). Defaults to 14.'),
  country: z
    .enum(['us', 'global'])
    .default('us')
    .describe('Country filter: "us" for United States only, "global" for major economies. Defaults to "us".'),
  impact: z
    .enum(['high', 'medium-high', 'all'])
    .default('high')
    .describe('Filter by impact level. Defaults to "high".'),
});

interface RawCalendarEvent {
  Date?: unknown;
  Country?: unknown;
  Category?: unknown;
  Event?: unknown;
  Reference?: unknown;
  Source?: unknown;
  Importance?: unknown;
  Actual?: unknown;
  Forecast?: unknown;
  Previous?: unknown;
}

interface CalendarEvent {
  date: string;
  country: string;
  event: string;
  category: string | null;
  importance: 'high' | 'medium-high' | 'medium' | 'low' | 'unknown';
  forecast: string | null;
  previous: string | null;
  actual: string | null;
  daysFromNow: number;
}

function impactFromImportance(value: unknown): CalendarEvent['importance'] {
  if (typeof value !== 'number') return 'unknown';
  // Trading Economics: 0=low, 1=medium, 2=high, 3=very high
  if (value >= 3) return 'high';
  if (value >= 2) return 'medium-high';
  if (value >= 1) return 'medium';
  return 'low';
}

interface FFEvent {
  title?: unknown;
  country?: unknown;
  date?: unknown;
  impact?: unknown;
  forecast?: unknown;
  previous?: unknown;
}

function impactFromFF(value: unknown): CalendarEvent['importance'] {
  if (typeof value !== 'string') return 'unknown';
  const v = value.toLowerCase();
  if (v === 'high') return 'high';
  if (v === 'medium') return 'medium-high';
  if (v === 'low') return 'low';
  return 'unknown';
}

const COUNTRY_CODE_TO_NAME: Record<string, string> = {
  USD: 'United States',
  EUR: 'Eurozone',
  GBP: 'United Kingdom',
  JPY: 'Japan',
  CAD: 'Canada',
  AUD: 'Australia',
  CHF: 'Switzerland',
  CNY: 'China',
  NZD: 'New Zealand',
};

/**
 * Fallback source: ForexFactory FairEconomy JSON feed (free, no auth).
 * Only returns the current week (~7 days). We cap daysAhead to 7 here.
 */
async function fetchForexFactory(
  todayMs: number,
  daysAhead: number,
  country: 'us' | 'global',
  minImportance: CalendarEvent['importance'],
): Promise<{ events: CalendarEvent[]; source: string }> {
  const url = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
  const resp = await safeFetch(
    url,
    {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; Alesia/1.0)',
      },
    },
    { maxRetries: 1, baseDelayMs: 500, timeoutMs: 10_000 },
  );
  if (!resp.ok) {
    throw new Error(`ForexFactory HTTP ${resp.status}`);
  }
  const json = (await resp.json()) as FFEvent[];
  if (!Array.isArray(json)) {
    throw new Error('ForexFactory returned non-array response');
  }

  const importanceRank = { unknown: 0, low: 1, medium: 2, 'medium-high': 3, high: 4 } as const;
  const cap = Math.min(daysAhead, 7);

  const events: CalendarEvent[] = json
    .map((row): CalendarEvent | null => {
      const title = typeof row.title === 'string' ? row.title : null;
      const dateRaw = typeof row.date === 'string' ? row.date : null;
      if (!title || !dateRaw) return null;
      const code = typeof row.country === 'string' ? row.country.toUpperCase() : '';
      if (country === 'us' && code !== 'USD') return null;
      const importance = impactFromFF(row.impact);
      if (importanceRank[importance] < importanceRank[minImportance]) return null;
      const days = daysBetween(dateRaw, todayMs);
      if (days < 0 || days > cap) return null;
      return {
        date: dateRaw.slice(0, 16).replace('T', ' '),
        country: COUNTRY_CODE_TO_NAME[code] ?? code,
        event: title,
        category: null,
        importance,
        forecast: typeof row.forecast === 'string' && row.forecast ? row.forecast : null,
        previous: typeof row.previous === 'string' && row.previous ? row.previous : null,
        actual: null,
        daysFromNow: days,
      };
    })
    .filter((e): e is CalendarEvent => e !== null)
    .sort((a, b) => a.daysFromNow - b.daysFromNow)
    .slice(0, 30);

  return { events, source: url };
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function daysBetween(targetIso: string, todayMs: number): number {
  const t = Date.parse(targetIso);
  if (!Number.isFinite(t)) return -1;
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.round((t - todayMs) / dayMs);
}

export const economicCalendarTool = new DynamicStructuredTool({
  name: 'economic_calendar',
  description:
    'Returns upcoming high-impact macro events (FOMC, CPI, NFP, GDP, PCE) for the next N days. Free, no API key. Use to flag volatility windows in macro analysis.',
  schema: EconomicCalendarSchema,
  func: async (input) => {
    try {
      const today = new Date();
      const todayMs = today.getTime();
      const startISO = today.toISOString().slice(0, 10);
      const end = new Date(todayMs + input.daysAhead * 24 * 60 * 60 * 1000);
      const endISO = end.toISOString().slice(0, 10);

      // Trading Economics' public guest calendar feed. The endpoint is
      // unauthenticated but rate-limited; safeFetch retries once on 5xx.
      const countryParam = input.country === 'us' ? 'united-states' : '';
      const baseUrl = countryParam
        ? `https://api.tradingeconomics.com/calendar/country/${countryParam}`
        : 'https://api.tradingeconomics.com/calendar';
      const url = `${baseUrl}?d1=${startISO}&d2=${endISO}&c=guest:guest&format=json`;

      const minImportance: CalendarEvent['importance'] =
        input.impact === 'high' ? 'high'
        : input.impact === 'medium-high' ? 'medium-high'
        : 'low';
      const importanceRank = { unknown: 0, low: 1, medium: 2, 'medium-high': 3, high: 4 } as const;

      // Try Trading Economics first; fall back to ForexFactory if it fails
      // (TE removed the guest endpoint in 2025 — currently returns 410).
      let teResp: Response | null = null;
      try {
        teResp = await safeFetch(
          url,
          { headers: { Accept: 'application/json', 'User-Agent': 'Alesia Financial Agent/1.0' } },
          { maxRetries: 1, baseDelayMs: 600, timeoutMs: 12_000 },
        );
      } catch {
        teResp = null;
      }

      let teJson: RawCalendarEvent[] | null = null;
      if (teResp && teResp.ok) {
        const parsed = (await teResp.json().catch(() => null)) as
          | RawCalendarEvent[]
          | Record<string, unknown>
          | null;
        if (Array.isArray(parsed)) teJson = parsed;
      }

      if (!teJson) {
        // Fallback: ForexFactory FairEconomy free JSON (current week only, ~7d).
        try {
          const fb = await fetchForexFactory(todayMs, input.daysAhead, input.country, minImportance);
          const nextHighImpact = fb.events.find(
            (e) => e.importance === 'high' || e.importance === 'medium-high',
          );
          return formatToolResult(
            {
              asOf: today.toISOString(),
              daysAhead: Math.min(input.daysAhead, 7),
              country: input.country,
              impact: input.impact,
              source: 'forexfactory',
              count: fb.events.length,
              nextHighImpact: nextHighImpact ?? null,
              events: fb.events,
              note:
                input.daysAhead > 7
                  ? 'ForexFactory feed is limited to 7 days; horizon was capped from your requested daysAhead.'
                  : undefined,
            },
            [fb.source, 'https://www.forexfactory.com/calendar'],
          );
        } catch (fbErr) {
          return formatToolResult(
            {
              error: `Both calendar sources failed (TE: HTTP ${teResp?.status ?? 'unreachable'}; FF: ${fbErr instanceof Error ? fbErr.message : String(fbErr)})`,
              hint: 'Use web_search "FOMC meeting date next" / "CPI release schedule" as a fallback.',
            },
            [url, 'https://www.forexfactory.com/calendar'],
          );
        }
      }

      const json = teJson;

      const events: CalendarEvent[] = json
        .map((row): CalendarEvent | null => {
          const dateRaw = asString(row.Date);
          if (!dateRaw) return null;
          const eventName = asString(row.Event);
          if (!eventName) return null;
          const importance = impactFromImportance(row.Importance);
          if (importanceRank[importance] < importanceRank[minImportance]) return null;
          const days = daysBetween(dateRaw, todayMs);
          if (days < 0 || days > input.daysAhead) return null;
          return {
            date: dateRaw.slice(0, 16).replace('T', ' '),
            country: asString(row.Country) ?? 'United States',
            event: eventName,
            category: asString(row.Category),
            importance,
            forecast: asString(row.Forecast),
            previous: asString(row.Previous),
            actual: asString(row.Actual),
            daysFromNow: days,
          };
        })
        .filter((e): e is CalendarEvent => e !== null)
        .sort((a, b) => a.daysFromNow - b.daysFromNow)
        .slice(0, 30);

      const nextHighImpact = events.find((e) => e.importance === 'high' || e.importance === 'medium-high');

      return formatToolResult(
        {
          asOf: today.toISOString(),
          daysAhead: input.daysAhead,
          country: input.country,
          impact: input.impact,
          count: events.length,
          nextHighImpact: nextHighImpact ?? null,
          events,
        },
        [url, 'https://tradingeconomics.com/calendar'],
      );
    } catch (error) {
      return formatToolResult(
        { error: `Economic calendar fetch failed: ${error instanceof Error ? error.message : String(error)}` },
        [],
      );
    }
  },
});
