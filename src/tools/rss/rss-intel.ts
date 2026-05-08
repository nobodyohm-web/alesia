/**
 * RSS Intelligence Tool — Universal free news & filings feed scanner.
 *
 * Dynamically constructs RSS feed URLs based on the query context (ticker, company name,
 * or topic). Fetches from multiple authoritative free sources in parallel and returns
 * the most relevant, recent items.
 *
 * Sources (all 100% FREE, no API key, no rate limit):
 * - SEC EDGAR Full-Text Search (filings, S-1, 10-K, 10-Q, 8-K, Form 4)
 * - SEC EDGAR Company RSS (all filings for a specific company)
 * - Google News RSS (any topic, any company, any sector)
 * - GlobeNewsWire RSS (official press releases)
 */
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { XMLParser } from 'fast-xml-parser';
import { formatToolResult } from '../types.js';
import { safeFetch } from '../../utils/retry.js';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
});

export const RSS_INTELLIGENCE_DESCRIPTION = `
Scans multiple free RSS feeds for the latest news, SEC filings, press releases, and market intelligence about a company or topic.
No API key required. Dynamically selects the best sources based on the query.
Use this to get the freshest possible information that may not yet appear in financial databases.
`.trim();

// ─── Feed URL Generators ────────────────────────────────────────────────────

export function buildSecEdgarCompanyUrl(ticker: string): string {
  // SEC EDGAR company filings RSS — returns all recent filings for a ticker
  return `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(ticker)}%22&dateRange=custom&startdt=${getDateDaysAgo(90)}&enddt=${getToday()}&from=0&size=15`;
}

export function buildSecEdgarFilingSearchUrl(query: string): string {
  // SEC EDGAR full-text search — finds specific filing content
  return `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(query)}%22&dateRange=custom&startdt=${getDateDaysAgo(30)}&enddt=${getToday()}&from=0&size=10`;
}

export function buildGoogleNewsUrl(query: string): string {
  // Google News RSS — works for any topic, company, or sector
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en&gl=US&ceid=US:en`;
}

export function buildGlobeNewswireUrl(query: string): string {
  // GlobeNewsWire search — official press releases
  return `https://www.globenewswire.com/RssFeed/searchresults/rss?query=${encodeURIComponent(query)}`;
}

export function buildSecEdgarIpoUrl(): string {
  // SEC EDGAR S-1 filings — all new IPO registration statements
  return `https://efts.sec.gov/LATEST/search-index?q=%22S-1%22&forms=S-1&dateRange=custom&startdt=${getDateDaysAgo(60)}&enddt=${getToday()}&from=0&size=15`;
}

// ─── Feed Fetchers ──────────────────────────────────────────────────────────

interface FeedItem {
  source: string;
  title: string;
  date: string;
  url: string;
  summary?: string;
}

const FEED_TIMEOUT_MS = 8000;
const FEED_RETRY = { maxRetries: 1, baseDelayMs: 400, timeoutMs: FEED_TIMEOUT_MS };

async function fetchGoogleNews(query: string): Promise<FeedItem[]> {
  try {
    const resp = await safeFetch(buildGoogleNewsUrl(query), {
      headers: { 'User-Agent': 'Alesia Financial Agent/1.0' },
    }, FEED_RETRY);
    if (!resp.ok) return [];
    const xml = await resp.text();
    const parsed = xmlParser.parse(xml);
    const channel = parsed?.rss?.channel;
    if (!channel) return [];
    const items = Array.isArray(channel.item) ? channel.item : channel.item ? [channel.item] : [];
    return items.slice(0, 10).map((item: Record<string, unknown>) => ({
      source: '📰 Google News',
      title: cleanHtml(String(item.title || '')),
      date: String(item.pubDate || ''),
      url: String(item.link || ''),
      summary: cleanHtml(String(item.description || '')).slice(0, 200),
    }));
  } catch {
    return [];
  }
}

async function fetchGlobeNewswire(query: string): Promise<FeedItem[]> {
  try {
    const resp = await safeFetch(buildGlobeNewswireUrl(query), {
      headers: { 'User-Agent': 'Alesia Financial Agent/1.0' },
    }, FEED_RETRY);
    if (!resp.ok) return [];
    const xml = await resp.text();
    const parsed = xmlParser.parse(xml);
    const channel = parsed?.rss?.channel;
    if (!channel) return [];
    const items = Array.isArray(channel.item) ? channel.item : channel.item ? [channel.item] : [];
    return items.slice(0, 8).map((item: Record<string, unknown>) => ({
      source: '📋 GlobeNewsWire (Press Release)',
      title: cleanHtml(String(item.title || '')),
      date: String(item.pubDate || ''),
      url: String(item.link || ''),
      summary: cleanHtml(String(item.description || '')).slice(0, 200),
    }));
  } catch {
    return [];
  }
}

async function fetchSecEdgar(ticker: string): Promise<FeedItem[]> {
  try {
    const resp = await safeFetch(buildSecEdgarCompanyUrl(ticker), {
      headers: {
        'User-Agent': 'Alesia Financial Agent contact@alesia.ai',
        'Accept': 'application/json',
      },
    }, FEED_RETRY);
    if (!resp.ok) return [];
    const data = await resp.json() as Record<string, unknown>;
    const hits = ((data.hits as Record<string, unknown>)?.hits as Array<Record<string, unknown>>) || [];
    return hits.slice(0, 10).map((hit) => {
      const src = hit._source as Record<string, unknown>;
      return {
        source: '🏛️ SEC EDGAR Filing',
        title: `${src.form_type || 'Filing'} — ${src.entity_name || src.display_names || ticker}`,
        date: String(src.file_date || ''),
        url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${ticker}&type=&dateb=&owner=include&count=10`,
        summary: `Form ${src.form_type} filed on ${src.file_date}. File #${src.file_num || 'N/A'}`,
      };
    });
  } catch {
    return [];
  }
}

async function fetchSecEdgarIpo(): Promise<FeedItem[]> {
  try {
    const resp = await safeFetch(buildSecEdgarIpoUrl(), {
      headers: {
        'User-Agent': 'Alesia Financial Agent contact@alesia.ai',
        'Accept': 'application/json',
      },
    }, FEED_RETRY);
    if (!resp.ok) return [];
    const data = await resp.json() as Record<string, unknown>;
    const hits = ((data.hits as Record<string, unknown>)?.hits as Array<Record<string, unknown>>) || [];
    return hits.slice(0, 15).map((hit) => {
      const src = hit._source as Record<string, unknown>;
      return {
        source: '🚀 SEC EDGAR (S-1 IPO Filing)',
        title: `S-1 Registration — ${src.entity_name || src.display_names || 'Unknown'}`,
        date: String(src.file_date || ''),
        url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${encodeURIComponent(String(src.entity_name || ''))}&CIK=&type=S-1&dateb=&owner=include&count=10&search_text=&action=getcompany`,
        summary: `New IPO registration statement filed on ${src.file_date}`,
      };
    });
  } catch {
    return [];
  }
}

// ─── Utility ────────────────────────────────────────────────────────────────

export function cleanHtml(text: string): string {
  return text.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

function getToday(): string {
  return new Date().toISOString().split('T')[0];
}

function getDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

// ─── Main Tool ──────────────────────────────────────────────────────────────

const RssIntelSchema = z.object({
  query: z.string().min(1).describe(
    "The search query. Can be a ticker symbol (e.g. 'FLY', 'TSLA'), a company name (e.g. 'Firefly Aerospace'), a topic (e.g. 'upcoming IPOs'), or a sector (e.g. 'AI stocks'). The tool will dynamically select the best RSS sources."
  ),
  mode: z.enum(['company', 'ipo', 'general']).default('company').describe(
    "'company' = focus on a specific company/ticker (SEC + News + Press Releases). " +
    "'ipo' = focus on new IPO filings (SEC S-1 + IPO news). " +
    "'general' = broad market/sector/topic search (News + Press Releases)."
  ),
  limit: z.number().int().min(1).max(20).default(5).describe(
    'Max items to return (1–20). Defaults to 5 (fits the token budget). Raise to 10–20 only for deep-research runs.'
  ),
});

export const rssIntelTool = new DynamicStructuredTool({
  name: 'rss_intelligence',
  description:
    'Scans multiple free RSS feeds (SEC EDGAR, Google News, GlobeNewsWire) in parallel to get the freshest news, filings, insider trades, press releases, and market intelligence about any company, sector, or topic. ' +
    'Use mode="company" for a specific stock, mode="ipo" for IPO scanning, mode="general" for broad topics. ' +
    'This tool is FREE, has no rate limits, and returns the most recent items sorted by date.',
  schema: RssIntelSchema,
  func: async (input) => {
    const query = input.query.trim();
    const feedPromises: Promise<FeedItem[]>[] = [];

    switch (input.mode) {
      case 'company': {
        // Ticker-specific: SEC filings + Google News + Press Releases
        const ticker = query.toUpperCase().replace(/[^A-Z]/g, '');
        feedPromises.push(fetchSecEdgar(ticker));
        feedPromises.push(fetchGoogleNews(`${query} stock`));
        feedPromises.push(fetchGlobeNewswire(query));
        break;
      }
      case 'ipo': {
        // IPO mode: S-1 filings + IPO news + IPO press releases
        feedPromises.push(fetchSecEdgarIpo());
        feedPromises.push(fetchGoogleNews('upcoming IPO 2026'));
        feedPromises.push(fetchGlobeNewswire('IPO initial public offering'));
        break;
      }
      case 'general': {
        // Broad search: News + Press Releases
        feedPromises.push(fetchGoogleNews(query));
        feedPromises.push(fetchGlobeNewswire(query));
        break;
      }
    }

    // Fetch all feeds in parallel for maximum speed
    const results = await Promise.allSettled(feedPromises);
    const allItems: FeedItem[] = [];

    for (const result of results) {
      if (result.status === 'fulfilled') {
        allItems.push(...result.value);
      }
    }

    // Sort by date (most recent first) and deduplicate by title
    const seen = new Set<string>();
    const unique = allItems.filter((item) => {
      const key = item.title.toLowerCase().slice(0, 60);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort by date descending
    unique.sort((a, b) => {
      const dateA = new Date(a.date).getTime() || 0;
      const dateB = new Date(b.date).getTime() || 0;
      return dateB - dateA;
    });

    const topItems = unique.slice(0, input.limit ?? 10);

    if (topItems.length === 0) {
      return formatToolResult(
        { message: `No RSS results found for "${query}". Try using web_search for more results.`, query },
        []
      );
    }

    return formatToolResult(
      {
        query,
        mode: input.mode,
        totalResults: topItems.length,
        items: topItems,
      },
      topItems.map((item) => item.url).filter(Boolean).slice(0, 5)
    );
  },
});
