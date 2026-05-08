import { describe, test, expect } from 'bun:test';
import { economicCalendarTool } from './economic-calendar.js';

describe('economicCalendarTool', () => {
  test('exposes the expected name', () => {
    expect(economicCalendarTool.name).toBe('economic_calendar');
  });

  test('schema applies sane defaults', () => {
    const parsed = economicCalendarTool.schema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.daysAhead).toBe(14);
      expect(parsed.data.country).toBe('us');
      expect(parsed.data.impact).toBe('high');
    }
  });

  test('schema clamps daysAhead to [1, 60]', () => {
    expect(economicCalendarTool.schema.safeParse({ daysAhead: 0 }).success).toBe(false);
    expect(economicCalendarTool.schema.safeParse({ daysAhead: 61 }).success).toBe(false);
    expect(economicCalendarTool.schema.safeParse({ daysAhead: 30 }).success).toBe(true);
  });

  test('schema rejects unknown country', () => {
    expect(
      economicCalendarTool.schema.safeParse({ country: 'eu' }).success,
    ).toBe(false);
  });

  test('schema rejects unknown impact', () => {
    expect(
      economicCalendarTool.schema.safeParse({ impact: 'nuclear' }).success,
    ).toBe(false);
  });

  test('returns valid envelope (or graceful error) on live call', async () => {
    const out = await economicCalendarTool.invoke({ daysAhead: 7, country: 'us', impact: 'high' });
    const parsed = JSON.parse(out as string) as {
      data: {
        error?: string;
        events?: unknown[];
        nextHighImpact?: unknown;
      };
    };
    // The Trading Economics public endpoint is rate-limited; either we get
    // a structured error envelope, or a structured events array. Both fine.
    expect(parsed).toHaveProperty('data');
    if (parsed.data.error) return;
    expect(Array.isArray(parsed.data.events)).toBe(true);
  }, 20_000);
});
