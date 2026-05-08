import { describe, test, expect } from 'bun:test';
import {
  parseMarkdownTable,
  renderBoxTable,
  transformMarkdownTables,
  transformBold,
  formatResponse,
} from './markdown-table.js';

describe('parseMarkdownTable', () => {
  test('parses a simple 2-column table', () => {
    const md = `
| Ticker | Price |
|--------|-------|
| AAPL   | 150   |
| MSFT   | 300   |
    `.trim();
    const parsed = parseMarkdownTable(md);
    expect(parsed).not.toBeNull();
    expect(parsed?.headers).toEqual(['Ticker', 'Price']);
    expect(parsed?.rows).toEqual([
      ['AAPL', '150'],
      ['MSFT', '300'],
    ]);
  });

  test('returns null for non-table text', () => {
    expect(parseMarkdownTable('Just plain text')).toBeNull();
  });

  test('returns null for a single line (insufficient table content)', () => {
    expect(parseMarkdownTable('| A | B |')).toBeNull();
  });

  test('handles tables with only one data row', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |';
    const parsed = parseMarkdownTable(md);
    expect(parsed?.rows.length).toBe(1);
  });
});

describe('renderBoxTable', () => {
  test('produces an output containing box-drawing characters', () => {
    const out = renderBoxTable(['A', 'B'], [['1', '2']]);
    expect(out).toContain('┌');
    expect(out).toContain('└');
    expect(out).toContain('│');
  });

  test('contains the header text and the row data', () => {
    const out = renderBoxTable(['Ticker', 'Price'], [['AAPL', '150']]);
    expect(out).toContain('Ticker');
    expect(out).toContain('Price');
    expect(out).toContain('AAPL');
    expect(out).toContain('150');
  });
});

describe('transformMarkdownTables', () => {
  test('converts an inline markdown table to a rendered box table', () => {
    const input = `Some intro text

| Ticker | Price |
|--------|-------|
| AAPL   | 150   |

Some outro text`;
    const out = transformMarkdownTables(input);
    expect(out).toContain('┌');
    expect(out).toContain('Some intro text');
    expect(out).toContain('Some outro text');
  });

  test('leaves text without tables untouched', () => {
    const text = 'Just a paragraph with no tables.';
    expect(transformMarkdownTables(text)).toBe(text);
  });
});

describe('transformBold', () => {
  test('renders **bold** segments', () => {
    const out = transformBold('Hello **world**');
    // Bold is implemented via chalk styling; we can't reliably assert ANSI
    // codes across platforms. Just ensure the **markers** are gone and the
    // word is preserved.
    expect(out).not.toContain('**world**');
    expect(out).toContain('world');
  });

  test('handles text without bold markers', () => {
    expect(transformBold('plain text')).toContain('plain text');
  });
});

describe('formatResponse', () => {
  test('passes through content end-to-end', () => {
    const out = formatResponse('Plain content with **bold** and a table');
    expect(out).toContain('Plain content');
  });

  test('combines table + bold transforms', () => {
    const input = `**Header**

| A | B |
|---|---|
| 1 | 2 |`;
    const out = formatResponse(input);
    expect(out).toContain('┌'); // table rendered
    expect(out).toContain('Header'); // bold word preserved
    expect(out).not.toContain('**Header**'); // markers gone
  });
});
