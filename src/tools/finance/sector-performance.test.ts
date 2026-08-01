import { describe, test, expect } from 'bun:test';
import { pctFromRatio, pctPoints, sectorPerformanceTool } from './sector-performance.js';

// Regression guard: Yahoo mixes units across fields. `regularMarketChangePercent`,
// `fiftyTwoWeekChangePercent` and `ytdReturn` are already percentage points,
// while the `*AverageChangePercent` family is a ratio. Multiplying the first
// group by 100 inflated every sector return by 100x.
describe('percentage conversion', () => {
  test('pctPoints leaves percentage-point values alone', () => {
    // Real Yahoo payload: XLK regularMarketChangePercent for a -0.22% day.
    expect(pctPoints(-0.216235)).toBe(-0.22);
    expect(pctPoints(36.42199)).toBe(36.42);
    expect(pctPoints(0)).toBe(0);
  });

  test('pctFromRatio converts ratios to percentage points', () => {
    // Real Yahoo payload: AAPL fiftyDayAverageChangePercent for a -0.19% gap.
    expect(pctFromRatio(-0.0019043203)).toBe(-0.19);
    expect(pctFromRatio(0.05081681)).toBe(5.08);
  });

  test('both reject non-finite input', () => {
    for (const helper of [pctPoints, pctFromRatio]) {
      expect(helper(null)).toBeNull();
      expect(helper(undefined)).toBeNull();
      expect(helper(NaN)).toBeNull();
      expect(helper(Infinity)).toBeNull();
      expect(helper('1.5')).toBeNull();
    }
  });

  test('a 1% day never reads as 100%', () => {
    const price = 101;
    const previousClose = 100;
    const yahooField = ((price - previousClose) / previousClose) * 100; // 1.0
    expect(pctPoints(yahooField)).toBeCloseTo(1, 5);
  });
});

describe('sectorPerformanceTool', () => {
  test('exposes the expected name', () => {
    expect(sectorPerformanceTool.name).toBe('sector_performance');
  });

  test('schema applies default includeBenchmarks=true', () => {
    const parsed = sectorPerformanceTool.schema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.includeBenchmarks).toBe(true);
  });

  test('schema accepts includeBenchmarks=false', () => {
    expect(
      sectorPerformanceTool.schema.safeParse({ includeBenchmarks: false }).success,
    ).toBe(true);
  });

  test('returns 11 sector ETFs + 3 benchmarks by default', async () => {
    const out = await sectorPerformanceTool.invoke({ includeBenchmarks: true });
    const parsed = JSON.parse(out as string) as {
      data: {
        error?: string;
        sectors?: Array<{ ticker: string; rank?: number }>;
        benchmarks?: Array<{ ticker: string }>;
        regime?: string;
      };
    };
    if (parsed.data.error) return;
    expect(parsed.data.sectors).toBeDefined();
    expect(parsed.data.sectors!.length).toBe(11);
    expect(parsed.data.benchmarks).toBeDefined();
    expect(parsed.data.benchmarks!.length).toBe(3);
    // Sectors should be ranked
    const ranks = parsed.data.sectors!.map((s) => s.rank);
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    // Regime is one of the known values
    expect(['risk-on', 'risk-off', 'neutral', 'unknown']).toContain(parsed.data.regime ?? 'unknown');
  }, 30_000);

  test('omits benchmarks when includeBenchmarks=false', async () => {
    const out = await sectorPerformanceTool.invoke({ includeBenchmarks: false });
    const parsed = JSON.parse(out as string) as {
      data: { error?: string; benchmarks?: unknown[]; sectors?: unknown[] };
    };
    if (parsed.data.error) return;
    expect(parsed.data.benchmarks?.length ?? 0).toBe(0);
    expect(parsed.data.sectors?.length).toBe(11);
  }, 30_000);
});
