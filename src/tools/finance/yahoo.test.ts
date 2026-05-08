import { describe, test, expect } from 'bun:test';
import {
  yahooQuoteTool,
  yahooHistoricalTool,
  yahooFinancialsTool,
  yahooKeyStatsTool,
  yahooSummaryTool,
} from './yahoo.js';

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

describe('yahooQuoteTool', () => {
  test('exposes the expected name and description', () => {
    expect(yahooQuoteTool.name).toBe('yahoo_quote');
    expect(yahooQuoteTool.description).toContain('Yahoo Finance');
  });

  test('schema accepts a valid ticker', () => {
    const parsed = yahooQuoteTool.schema.safeParse({ ticker: 'AAPL' });
    expect(parsed.success).toBe(true);
  });

  test('schema rejects missing ticker', () => {
    const parsed = yahooQuoteTool.schema.safeParse({});
    expect(parsed.success).toBe(false);
  });

  test('schema rejects non-string ticker', () => {
    const parsed = yahooQuoteTool.schema.safeParse({ ticker: 42 });
    expect(parsed.success).toBe(false);
  });
});

describe('yahooHistoricalTool', () => {
  test('schema accepts valid period and interval', () => {
    const parsed = yahooHistoricalTool.schema.safeParse({
      ticker: 'AAPL',
      period: '1y',
      interval: '1d',
    });
    expect(parsed.success).toBe(true);
  });

  test('schema applies default period and interval when omitted', () => {
    const parsed = yahooHistoricalTool.schema.safeParse({ ticker: 'AAPL' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.period).toBe('1y');
      expect(parsed.data.interval).toBe('1d');
    }
  });

  test('schema rejects invalid period enum', () => {
    const parsed = yahooHistoricalTool.schema.safeParse({
      ticker: 'AAPL',
      period: '13mo',
    });
    expect(parsed.success).toBe(false);
  });

  test('schema rejects invalid interval enum', () => {
    const parsed = yahooHistoricalTool.schema.safeParse({
      ticker: 'AAPL',
      interval: '5m',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('yahooFinancialsTool', () => {
  test('schema accepts valid statement and frequency', () => {
    const parsed = yahooFinancialsTool.schema.safeParse({
      ticker: 'AAPL',
      statement: 'income',
      frequency: 'annual',
    });
    expect(parsed.success).toBe(true);
  });

  test('schema applies defaults for statement and frequency', () => {
    const parsed = yahooFinancialsTool.schema.safeParse({ ticker: 'AAPL' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.statement).toBe('income');
      expect(parsed.data.frequency).toBe('annual');
    }
  });

  test('schema rejects invalid statement enum', () => {
    const parsed = yahooFinancialsTool.schema.safeParse({
      ticker: 'AAPL',
      statement: 'equity',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('yahooKeyStatsTool', () => {
  test('exposes the expected name', () => {
    expect(yahooKeyStatsTool.name).toBe('yahoo_key_stats');
  });

  test('schema accepts a valid ticker', () => {
    const parsed = yahooKeyStatsTool.schema.safeParse({ ticker: 'TSLA' });
    expect(parsed.success).toBe(true);
  });
});

describe('yahooSummaryTool', () => {
  test('exposes the expected name', () => {
    expect(yahooSummaryTool.name).toBe('yahoo_summary');
  });

  test('schema accepts a valid ticker', () => {
    const parsed = yahooSummaryTool.schema.safeParse({ ticker: 'NVDA' });
    expect(parsed.success).toBe(true);
  });

  test('schema rejects empty input', () => {
    const parsed = yahooSummaryTool.schema.safeParse({});
    expect(parsed.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatToolResult on error path
// ---------------------------------------------------------------------------

describe('error handling', () => {
  test('yahooQuoteTool returns a valid formatToolResult JSON envelope on failure', async () => {
    // An obviously invalid ticker triggers the catch branch in yahoo.ts.
    const out = await yahooQuoteTool.invoke({ ticker: '___INVALID_ALESIA_TEST___' });
    expect(typeof out).toBe('string');
    const parsed = JSON.parse(out as string) as { data: { error?: string } };
    expect(parsed).toHaveProperty('data');
    // Either the call surfaced an error, or it returned an empty payload.
    // Either way, we must NOT crash and the envelope must be valid JSON.
    expect(typeof parsed.data).toBe('object');
  }, 30_000);
});

// ---------------------------------------------------------------------------
// yahoo_summary integration: AAPL must return enriched annual financials
// ---------------------------------------------------------------------------

describe('yahooSummaryTool integration (AAPL)', () => {
  test('returns 9 top-level fields with non-empty enriched annualFinancials', async () => {
    const out = await yahooSummaryTool.invoke({ ticker: 'AAPL' });
    expect(typeof out).toBe('string');
    const parsed = JSON.parse(out as string) as {
      data: Record<string, unknown> & {
        error?: string;
        annualFinancials?: Array<Record<string, unknown>>;
      };
    };
    if (parsed.data.error) {
      // Network failure / Yahoo throttling — skip rather than fail CI.
      return;
    }
    // yahoo_summary now folds financialData into keyStatistics to keep the
    // tool result under the ~2k-token budget defined in CLAUDE.md.
    const expectedFields = [
      'price',
      'summaryDetail',
      'keyStatistics',
      'earningsHistory',
      'recommendations',
      'insiderHolders',
      'annualFinancials',
      'quarterlyFinancials',
    ];
    for (const field of expectedFields) {
      expect(Object.keys(parsed.data)).toContain(field);
    }
    const annual = parsed.data.annualFinancials ?? [];
    expect(Array.isArray(annual)).toBe(true);
    expect(annual.length).toBeGreaterThan(0);
    for (const entry of annual) {
      expect(entry).toHaveProperty('totalRevenue');
      expect(entry).toHaveProperty('netIncome');
    }
  }, 60_000);
});
