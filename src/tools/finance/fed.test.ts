import { describe, test, expect } from 'bun:test';
import { fedRatesTool } from './fed.js';

describe('fedRatesTool', () => {
  test('exposes the expected name and mentions the key rates', () => {
    expect(fedRatesTool.name).toBe('fed_rates');
    expect(fedRatesTool.description).toContain('EFFR');
    expect(fedRatesTool.description).toContain('SOFR');
  });

  test('schema defaults to the latest observation only', () => {
    const parsed = fedRatesTool.schema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.history).toBe(1);
  });

  test('schema bounds the history window', () => {
    expect(fedRatesTool.schema.safeParse({ history: 0 }).success).toBe(false);
    expect(fedRatesTool.schema.safeParse({ history: 61 }).success).toBe(false);
    expect(fedRatesTool.schema.safeParse({ history: 30 }).success).toBe(true);
  });
});
