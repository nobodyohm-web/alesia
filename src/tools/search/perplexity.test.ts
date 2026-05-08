import { describe, test, expect } from 'bun:test';
import { perplexitySearch } from './perplexity.js';

describe('perplexitySearch', () => {
  test('exposes the expected name', () => {
    expect(perplexitySearch.name).toBe('web_search');
  });

  test('description references web search', () => {
    expect(perplexitySearch.description.toLowerCase()).toContain('web');
  });

  test('schema accepts a valid query', () => {
    expect(
      perplexitySearch.schema.safeParse({ query: 'TSLA Q4 results' }).success,
    ).toBe(true);
  });

  test('schema rejects empty query', () => {
    expect(perplexitySearch.schema.safeParse({ query: '' }).success).toBe(false);
  });

  test('schema rejects missing query', () => {
    expect(perplexitySearch.schema.safeParse({}).success).toBe(false);
  });

  test('error path returns a JSON envelope when API key is missing', async () => {
    const original = process.env.PERPLEXITY_API_KEY;
    delete process.env.PERPLEXITY_API_KEY;
    try {
      const out = await perplexitySearch.invoke({ query: 'envelope shape test' });
      expect(typeof out).toBe('string');
      const parsed = JSON.parse(out as string) as { data: { error?: string } };
      expect(parsed).toHaveProperty('data');
      expect(parsed.data).toHaveProperty('error');
      expect(parsed.data.error).toContain('Perplexity');
    } finally {
      if (original !== undefined) process.env.PERPLEXITY_API_KEY = original;
    }
  }, 10_000);
});
