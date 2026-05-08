import { describe, test, expect } from 'bun:test';
import { exaSearch } from './exa.js';

describe('exaSearch', () => {
  test('exposes the expected name', () => {
    expect(exaSearch.name).toBe('web_search');
  });

  test('description references web search', () => {
    expect(exaSearch.description.toLowerCase()).toContain('web');
  });

  test('schema accepts a non-empty query', () => {
    expect(exaSearch.schema.safeParse({ query: 'AAPL earnings' }).success).toBe(true);
  });

  test('schema rejects an empty query', () => {
    expect(exaSearch.schema.safeParse({ query: '' }).success).toBe(false);
  });

  test('schema rejects a missing query field', () => {
    expect(exaSearch.schema.safeParse({}).success).toBe(false);
  });

  test('schema rejects a non-string query', () => {
    expect(exaSearch.schema.safeParse({ query: 42 }).success).toBe(false);
  });

  test('error path returns a JSON envelope (not a thrown exception)', async () => {
    // The SDK will fail without a valid API key; we verify the catch branch
    // surfaces a structured error rather than crashing the executor.
    const original = process.env.EXASEARCH_API_KEY;
    process.env.EXASEARCH_API_KEY = 'invalid-key-for-test';
    try {
      const out = await exaSearch.invoke({ query: 'test query for envelope shape' });
      expect(typeof out).toBe('string');
      const parsed = JSON.parse(out as string) as { data: Record<string, unknown> };
      expect(parsed).toHaveProperty('data');
      expect(typeof parsed.data).toBe('object');
    } finally {
      if (original === undefined) delete process.env.EXASEARCH_API_KEY;
      else process.env.EXASEARCH_API_KEY = original;
    }
  }, 20_000);
});
