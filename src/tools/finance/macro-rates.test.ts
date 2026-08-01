import { describe, test, expect } from 'bun:test';
import { normaliseMaturity, parseCsv, toIso, treasuryYieldsTool } from './macro-rates.js';

describe('treasuryYieldsTool', () => {
  test('exposes the expected name', () => {
    expect(treasuryYieldsTool.name).toBe('treasury_yields');
  });

  test('schema applies defaults', () => {
    const parsed = treasuryYieldsTool.schema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.days).toBe(5);
      expect(parsed.data.includeReal).toBe(true);
    }
  });

  test('schema rejects an out-of-range day count', () => {
    expect(treasuryYieldsTool.schema.safeParse({ days: 0 }).success).toBe(false);
    expect(treasuryYieldsTool.schema.safeParse({ days: 31 }).success).toBe(false);
  });
});

// Treasury labels the same maturity differently across its two files
// ("10 Yr" nominal vs "10 YR" real), so joining them requires normalisation.
describe('normaliseMaturity', () => {
  test('normalises both spellings to one key', () => {
    expect(normaliseMaturity('10 Yr')).toBe('10Y');
    expect(normaliseMaturity('"10 YR"')).toBe('10Y');
    expect(normaliseMaturity('1 Mo')).toBe('1M');
    expect(normaliseMaturity('1.5 Month')).toBe('1.5M');
    expect(normaliseMaturity('30 YR')).toBe('30Y');
  });

  test('returns null for non-maturity columns', () => {
    expect(normaliseMaturity('Date')).toBeNull();
    expect(normaliseMaturity('')).toBeNull();
  });
});

describe('parseCsv', () => {
  test('keeps quoted headers containing commas and spaces intact', () => {
    const { headers, rows } = parseCsv('Date,"1 Mo","10 Yr"\n07/31/2026,3.78,4.75\n');
    expect(headers).toEqual(['Date', '1 Mo', '10 Yr']);
    expect(rows).toEqual([['07/31/2026', '3.78', '4.75']]);
  });

  test('ignores blank trailing lines', () => {
    expect(parseCsv('Date,"1 Mo"\n07/31/2026,3.78\n\n').rows).toHaveLength(1);
  });
});

describe('toIso', () => {
  test('converts MM/DD/YYYY so dates sort lexicographically', () => {
    expect(toIso('07/31/2026')).toBe('2026-07-31');
    expect(toIso('1/5/2026')).toBe('2026-01-05');
    // The whole point: string sort must match chronological order.
    expect(['09/01/2026', '10/01/2026'].map(toIso).sort()).toEqual(['2026-09-01', '2026-10-01']);
  });

  test('passes through anything that is not a US date', () => {
    expect(toIso('2026-07-31')).toBe('2026-07-31');
  });
});
