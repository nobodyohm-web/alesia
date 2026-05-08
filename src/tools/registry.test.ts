import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  getToolRegistry,
  getTools,
  getToolConcurrencyMap,
  buildCompactToolDescriptions,
} from './registry.js';

const SAVED_ENV = { ...process.env };

beforeEach(() => {
  // Restore the world before each test — these tests mutate env keys
  // to exercise the conditional-loading branches.
  process.env = { ...SAVED_ENV };
});

afterEach(() => {
  process.env = { ...SAVED_ENV };
});

describe('getToolRegistry — always-on free tools', () => {
  test('exposes the canonical free tools regardless of API keys', () => {
    delete process.env.FINANCIAL_DATASETS_API_KEY;
    delete process.env.EXASEARCH_API_KEY;
    delete process.env.PERPLEXITY_API_KEY;
    delete process.env.TAVILY_API_KEY;
    delete process.env.X_BEARER_TOKEN;
    const names = getToolRegistry('gpt-5.4').map((t) => t.name);

    // Free Yahoo / Binance / RSS / IPO / sentiment tools always present
    expect(names).toContain('yahoo_summary');
    expect(names).toContain('yahoo_quote');
    expect(names).toContain('yahoo_historical');
    expect(names).toContain('yahoo_financials');
    expect(names).toContain('yahoo_key_stats');
    expect(names).toContain('binance_price');
    expect(names).toContain('binance_klines');
    expect(names).toContain('binance_top_movers');
    expect(names).toContain('rss_intelligence');
    expect(names).toContain('ipo_tracker');
    expect(names).toContain('insider_detector');
    expect(names).toContain('analyst_consensus');
    expect(names).toContain('fear_greed_index');
    expect(names).toContain('crypto_market_cap');
    expect(names).toContain('sector_performance');
    expect(names).toContain('economic_calendar');

    // Filesystem + utilities always present
    expect(names).toContain('read_file');
    expect(names).toContain('write_file');
    expect(names).toContain('edit_file');
    expect(names).toContain('memory_search');
  });
});

describe('getToolRegistry — paid meta-tools are conditional', () => {
  test('omits get_financials/get_market_data when no FinancialDatasets key', () => {
    delete process.env.FINANCIAL_DATASETS_API_KEY;
    const names = getToolRegistry('gpt-5.4').map((t) => t.name);
    expect(names).not.toContain('get_financials');
    expect(names).not.toContain('get_market_data');
    expect(names).not.toContain('read_filings');
    expect(names).not.toContain('stock_screener');
  });

  test('includes paid meta-tools when FINANCIAL_DATASETS_API_KEY is set', () => {
    process.env.FINANCIAL_DATASETS_API_KEY = 'test-key';
    const names = getToolRegistry('gpt-5.4').map((t) => t.name);
    expect(names).toContain('get_financials');
    expect(names).toContain('get_market_data');
    expect(names).toContain('read_filings');
    expect(names).toContain('stock_screener');
  });
});

describe('getToolRegistry — search provider cascade', () => {
  test('prefers Exa when EXASEARCH_API_KEY is set', () => {
    process.env.EXASEARCH_API_KEY = 'x';
    process.env.PERPLEXITY_API_KEY = 'p';
    process.env.TAVILY_API_KEY = 't';
    const names = getToolRegistry('gpt-5.4').map((t) => t.name);
    const webSearches = names.filter((n) => n === 'web_search');
    expect(webSearches.length).toBe(1);
  });

  test('falls back to Perplexity when only PERPLEXITY_API_KEY is set', () => {
    delete process.env.EXASEARCH_API_KEY;
    process.env.PERPLEXITY_API_KEY = 'p';
    delete process.env.TAVILY_API_KEY;
    const names = getToolRegistry('gpt-5.4').map((t) => t.name);
    expect(names).toContain('web_search');
  });

  test('omits web_search when no search key is set', () => {
    delete process.env.EXASEARCH_API_KEY;
    delete process.env.PERPLEXITY_API_KEY;
    delete process.env.TAVILY_API_KEY;
    const names = getToolRegistry('gpt-5.4').map((t) => t.name);
    expect(names).not.toContain('web_search');
  });
});

describe('getToolRegistry — X/Twitter is gated by X_BEARER_TOKEN', () => {
  test('includes x_search when token is set', () => {
    process.env.X_BEARER_TOKEN = 'bearer';
    expect(getToolRegistry('gpt-5.4').map((t) => t.name)).toContain('x_search');
  });

  test('omits x_search without token', () => {
    delete process.env.X_BEARER_TOKEN;
    expect(getToolRegistry('gpt-5.4').map((t) => t.name)).not.toContain('x_search');
  });
});

describe('getToolRegistry — concurrency flags', () => {
  test('write_file and edit_file are NOT concurrency-safe', () => {
    const reg = getToolRegistry('gpt-5.4');
    const writeFile = reg.find((t) => t.name === 'write_file');
    const editFile = reg.find((t) => t.name === 'edit_file');
    expect(writeFile?.concurrencySafe).toBe(false);
    expect(editFile?.concurrencySafe).toBe(false);
  });

  test('memory_update is NOT concurrency-safe', () => {
    const reg = getToolRegistry('gpt-5.4');
    expect(reg.find((t) => t.name === 'memory_update')?.concurrencySafe).toBe(false);
  });

  test('browser is NOT concurrency-safe (shared state)', () => {
    const reg = getToolRegistry('gpt-5.4');
    expect(reg.find((t) => t.name === 'browser')?.concurrencySafe).toBe(false);
  });

  test('read-only data tools ARE concurrency-safe', () => {
    const reg = getToolRegistry('gpt-5.4');
    const readers = ['yahoo_summary', 'binance_price', 'rss_intelligence', 'fear_greed_index', 'crypto_market_cap', 'sector_performance', 'economic_calendar'];
    for (const name of readers) {
      const tool = reg.find((t) => t.name === name);
      expect(tool?.concurrencySafe).toBe(true);
    }
  });
});

describe('getToolRegistry — descriptions and shape', () => {
  test('every tool has both description and compactDescription', () => {
    const reg = getToolRegistry('gpt-5.4');
    expect(reg.length).toBeGreaterThan(0);
    for (const tool of reg) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.compactDescription.length).toBeGreaterThan(0);
    }
  });

  test('every registered tool name matches the underlying tool.name', () => {
    const reg = getToolRegistry('gpt-5.4');
    for (const r of reg) {
      expect(r.tool.name).toBe(r.name);
    }
  });

  test('tool names are unique', () => {
    const names = getToolRegistry('gpt-5.4').map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('getToolConcurrencyMap', () => {
  test('returns a map containing every registered tool name', () => {
    const reg = getToolRegistry('gpt-5.4');
    const map = getToolConcurrencyMap('gpt-5.4');
    for (const t of reg) {
      expect(map.get(t.name)).toBe(t.concurrencySafe);
    }
  });
});

describe('getTools', () => {
  test('returns the same number of tools as the registry', () => {
    expect(getTools('gpt-5.4').length).toBe(getToolRegistry('gpt-5.4').length);
  });
});

describe('buildCompactToolDescriptions', () => {
  test('contains a bullet line per tool', () => {
    const reg = getToolRegistry('gpt-5.4');
    const compact = buildCompactToolDescriptions('gpt-5.4');
    const lines = compact.split('\n');
    expect(lines.length).toBe(reg.length);
    for (const line of lines) {
      expect(line.startsWith('- **')).toBe(true);
    }
  });
});
