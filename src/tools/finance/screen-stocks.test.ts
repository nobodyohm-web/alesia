import { describe, test, expect } from 'bun:test';
import type { z } from 'zod';
import { createScreenStocks, SCREEN_STOCKS_DESCRIPTION } from './screen-stocks.js';

// DynamicStructuredTool widens the schema type — cast back to a zod schema for testing.
type ZSchema = z.ZodSchema<unknown>;

describe('createScreenStocks', () => {
  test('SCREEN_STOCKS_DESCRIPTION mentions screening', () => {
    expect(SCREEN_STOCKS_DESCRIPTION.toLowerCase()).toContain('screen');
  });

  test('returns a tool named stock_screener', () => {
    const tool = createScreenStocks('gpt-5.4');
    expect(tool.name).toBe('stock_screener');
  });

  test('schema accepts a query', () => {
    const tool = createScreenStocks('gpt-5.4');
    const schema = tool.schema as unknown as ZSchema;
    expect(schema.safeParse({ query: 'P/E below 15 and ROE above 15%' }).success).toBe(true);
  });

  test('schema rejects missing query', () => {
    const tool = createScreenStocks('gpt-5.4');
    const schema = tool.schema as unknown as ZSchema;
    expect(schema.safeParse({}).success).toBe(false);
  });

  test('schema rejects non-string query', () => {
    const tool = createScreenStocks('gpt-5.4');
    const schema = tool.schema as unknown as ZSchema;
    expect(schema.safeParse({ query: { foo: 'bar' } }).success).toBe(false);
  });
});
