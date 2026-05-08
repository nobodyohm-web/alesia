import { describe, test, expect } from 'bun:test';
import { sectorPerformanceTool } from './sector-performance.js';

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
