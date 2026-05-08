import { describe, test, expect } from 'bun:test';
import {
  rssIntelTool,
  cleanHtml,
  buildGoogleNewsUrl,
  buildGlobeNewswireUrl,
  buildSecEdgarCompanyUrl,
  buildSecEdgarFilingSearchUrl,
  buildSecEdgarIpoUrl,
} from './rss-intel.js';

// ---------------------------------------------------------------------------
// URL builders
// ---------------------------------------------------------------------------

describe('buildGoogleNewsUrl', () => {
  test('encodes simple queries', () => {
    const url = buildGoogleNewsUrl('AAPL stock');
    expect(url).toContain('https://news.google.com/rss/search');
    expect(url).toContain('q=AAPL%20stock');
    expect(url).toContain('hl=en');
  });

  test('encodes special characters', () => {
    const url = buildGoogleNewsUrl('M&A deals');
    expect(url).toContain('M%26A%20deals');
  });
});

describe('buildGlobeNewswireUrl', () => {
  test('embeds the query in the search URL', () => {
    const url = buildGlobeNewswireUrl('Tesla');
    expect(url).toContain('https://www.globenewswire.com/RssFeed/searchresults/rss');
    expect(url).toContain('query=Tesla');
  });
});

describe('buildSecEdgarCompanyUrl', () => {
  test('embeds ticker and a 90-day window', () => {
    const url = buildSecEdgarCompanyUrl('AAPL');
    expect(url).toContain('https://efts.sec.gov/LATEST/search-index');
    expect(url).toContain('AAPL');
    expect(url).toMatch(/startdt=\d{4}-\d{2}-\d{2}/);
    expect(url).toMatch(/enddt=\d{4}-\d{2}-\d{2}/);
  });
});

describe('buildSecEdgarFilingSearchUrl', () => {
  test('encodes the query and includes a 30-day window', () => {
    const url = buildSecEdgarFilingSearchUrl('insider trading');
    expect(url).toContain('insider%20trading');
    expect(url).toMatch(/startdt=\d{4}-\d{2}-\d{2}/);
  });
});

describe('buildSecEdgarIpoUrl', () => {
  test('targets S-1 filings with a 60-day window', () => {
    const url = buildSecEdgarIpoUrl();
    expect(url).toContain('forms=S-1');
    expect(url).toMatch(/startdt=\d{4}-\d{2}-\d{2}/);
    expect(url).toMatch(/enddt=\d{4}-\d{2}-\d{2}/);
  });
});

// ---------------------------------------------------------------------------
// cleanHtml
// ---------------------------------------------------------------------------

describe('cleanHtml', () => {
  test('strips HTML tags', () => {
    expect(cleanHtml('<p>Hello <b>world</b></p>')).toBe('Hello world');
  });

  test('decodes common entities', () => {
    expect(cleanHtml('Tom &amp; Jerry')).toBe('Tom & Jerry');
    expect(cleanHtml('5 &lt; 10 &gt; 2')).toBe('5 < 10 > 2');
    expect(cleanHtml('&quot;quoted&quot;')).toBe('"quoted"');
    expect(cleanHtml('it&#39;s')).toBe("it's");
  });

  test('trims whitespace and handles empty input', () => {
    expect(cleanHtml('   <span>x</span>   ')).toBe('x');
    expect(cleanHtml('')).toBe('');
  });

  test('handles a realistic RSS description', () => {
    const html = '<p>Apple <a href="x">reports</a> Q4 earnings &amp; raises guidance.</p>';
    expect(cleanHtml(html)).toBe('Apple reports Q4 earnings & raises guidance.');
  });
});

// ---------------------------------------------------------------------------
// Tool schema + mode handling
// ---------------------------------------------------------------------------

describe('rssIntelTool', () => {
  test('exposes the expected name', () => {
    expect(rssIntelTool.name).toBe('rss_intelligence');
  });

  test('schema accepts each valid mode', () => {
    for (const mode of ['company', 'ipo', 'general'] as const) {
      const parsed = rssIntelTool.schema.safeParse({ query: 'AAPL', mode });
      expect(parsed.success).toBe(true);
    }
  });

  test('schema applies default mode when omitted', () => {
    const parsed = rssIntelTool.schema.safeParse({ query: 'AAPL' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.mode).toBe('company');
    }
  });

  test('schema rejects unknown modes', () => {
    const parsed = rssIntelTool.schema.safeParse({ query: 'AAPL', mode: 'unknown' });
    expect(parsed.success).toBe(false);
  });

  test('schema rejects missing query', () => {
    const parsed = rssIntelTool.schema.safeParse({ mode: 'company' });
    expect(parsed.success).toBe(false);
  });
});
