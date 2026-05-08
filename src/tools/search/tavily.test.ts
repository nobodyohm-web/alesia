import { describe, test, expect } from 'bun:test';
import { tavilySearch } from './tavily.js';

describe('tavilySearch', () => {
  test('exposes the expected name', () => {
    expect(tavilySearch.name).toBe('web_search');
  });

  test('description references web search', () => {
    expect(tavilySearch.description.toLowerCase()).toContain('web');
  });

  test('schema accepts a valid query', () => {
    expect(tavilySearch.schema.safeParse({ query: 'AAPL upcoming earnings' }).success).toBe(true);
  });

  test('schema rejects empty query', () => {
    expect(tavilySearch.schema.safeParse({ query: '' }).success).toBe(false);
  });

  test('schema rejects missing query', () => {
    expect(tavilySearch.schema.safeParse({}).success).toBe(false);
  });

  test('schema rejects non-string query', () => {
    expect(tavilySearch.schema.safeParse({ query: ['array'] }).success).toBe(false);
  });
});
