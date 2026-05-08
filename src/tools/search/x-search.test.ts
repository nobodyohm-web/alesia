import { describe, test, expect } from 'bun:test';
import { xSearchTool } from './x-search.js';

describe('xSearchTool', () => {
  test('exposes the expected name', () => {
    expect(xSearchTool.name).toBe('x_search');
  });

  test('schema accepts a search command with a query', () => {
    expect(
      xSearchTool.schema.safeParse({ command: 'search', query: '$AAPL' }).success,
    ).toBe(true);
  });

  test('schema accepts a profile command with a username', () => {
    expect(
      xSearchTool.schema.safeParse({ command: 'profile', username: 'elonmusk' }).success,
    ).toBe(true);
  });

  test('schema accepts a thread command with a tweet id', () => {
    expect(
      xSearchTool.schema.safeParse({ command: 'thread', query: '1234567890' }).success,
    ).toBe(true);
  });

  test('schema rejects unknown command', () => {
    expect(
      xSearchTool.schema.safeParse({ command: 'mention', query: 'x' }).success,
    ).toBe(false);
  });

  test('schema applies default sort=likes and limit=15', () => {
    const parsed = xSearchTool.schema.safeParse({ command: 'search', query: '$BTC' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.sort).toBe('likes');
      expect(parsed.data.limit).toBe(15);
      expect(parsed.data.pages).toBe(1);
    }
  });

  test('schema rejects pages > 5', () => {
    expect(
      xSearchTool.schema.safeParse({ command: 'search', query: 'x', pages: 6 }).success,
    ).toBe(false);
  });

  test('schema rejects pages < 1', () => {
    expect(
      xSearchTool.schema.safeParse({ command: 'search', query: 'x', pages: 0 }).success,
    ).toBe(false);
  });

  test('schema rejects negative min_likes', () => {
    expect(
      xSearchTool.schema.safeParse({ command: 'search', query: 'x', min_likes: -1 }).success,
    ).toBe(false);
  });

  test('schema rejects unknown sort value', () => {
    expect(
      xSearchTool.schema.safeParse({ command: 'search', query: 'x', sort: 'random' }).success,
    ).toBe(false);
  });

  test('search command without query is parseable but fails at runtime', async () => {
    // Schema allows query to be optional (some commands don't need it),
    // but search requires it — verify the runtime check fires.
    const original = process.env.X_BEARER_TOKEN;
    process.env.X_BEARER_TOKEN = 'fake-token-for-runtime-test';
    try {
      // search without query should throw inside func
      await expect(
        xSearchTool.invoke({ command: 'search' }),
      ).rejects.toThrow(/query is required|x_search/i);
    } finally {
      if (original === undefined) delete process.env.X_BEARER_TOKEN;
      else process.env.X_BEARER_TOKEN = original;
    }
  }, 10_000);
});
