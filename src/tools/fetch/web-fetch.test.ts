import { describe, test, expect } from 'bun:test';
import { webFetchTool } from './web-fetch.js';

describe('webFetchTool', () => {
  test('exposes the expected name', () => {
    expect(webFetchTool.name).toBe('web_fetch');
  });

  test('schema accepts a valid HTTPS URL', () => {
    expect(webFetchTool.schema.safeParse({ url: 'https://example.com' }).success).toBe(true);
  });

  test('schema accepts an HTTP URL', () => {
    expect(webFetchTool.schema.safeParse({ url: 'http://example.com' }).success).toBe(true);
  });

  test('schema rejects missing url', () => {
    expect(webFetchTool.schema.safeParse({}).success).toBe(false);
  });

  test('schema accepts extractMode markdown', () => {
    expect(
      webFetchTool.schema.safeParse({ url: 'https://example.com', extractMode: 'markdown' }).success,
    ).toBe(true);
  });

  test('schema accepts extractMode text', () => {
    expect(
      webFetchTool.schema.safeParse({ url: 'https://example.com', extractMode: 'text' }).success,
    ).toBe(true);
  });

  test('schema rejects unknown extractMode', () => {
    expect(
      webFetchTool.schema.safeParse({ url: 'https://example.com', extractMode: 'pdf' }).success,
    ).toBe(false);
  });

  test('schema rejects maxChars below 100', () => {
    expect(
      webFetchTool.schema.safeParse({ url: 'https://example.com', maxChars: 50 }).success,
    ).toBe(false);
  });

  test('schema accepts maxChars >= 100', () => {
    expect(
      webFetchTool.schema.safeParse({ url: 'https://example.com', maxChars: 5000 }).success,
    ).toBe(true);
  });

  test('runtime rejects non-http(s) URLs', async () => {
    await expect(
      webFetchTool.invoke({ url: 'file:///etc/passwd' }),
    ).rejects.toThrow(/Invalid URL|http or https/i);
  });

  test('runtime rejects malformed URLs', async () => {
    await expect(
      webFetchTool.invoke({ url: 'not a url' }),
    ).rejects.toThrow(/Invalid URL|http or https/i);
  });
});
