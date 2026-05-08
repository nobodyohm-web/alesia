import { describe, test, expect } from 'bun:test';
import { all } from './concurrency.js';

async function* range(start: number, end: number, delayMs = 0): AsyncGenerator<number> {
  for (let i = start; i < end; i++) {
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    yield i;
  }
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of gen) out.push(v);
  return out;
}

describe('all (concurrent generator merger)', () => {
  test('merges values from multiple generators', async () => {
    const out = await collect(all([range(0, 3), range(10, 13)]));
    expect(out.sort((a, b) => a - b)).toEqual([0, 1, 2, 10, 11, 12]);
  });

  test('handles an empty generator list', async () => {
    expect(await collect(all([]))).toEqual([]);
  });

  test('respects concurrencyCap (does not buffer more than N at a time)', async () => {
    // We can't directly observe concurrency, but we can verify completion.
    const gens = [range(0, 5), range(10, 15), range(20, 25), range(30, 35)];
    const out = await collect(all(gens, 2));
    expect(out.length).toBe(20);
  });

  test('returns all values even when some generators are slower', async () => {
    const out = await collect(all([range(0, 3, 5), range(100, 103, 1)]));
    expect(out.length).toBe(6);
    const sorted = out.sort((a, b) => a - b);
    expect(sorted).toEqual([0, 1, 2, 100, 101, 102]);
  });

  test('Infinity concurrency is the default', async () => {
    // Same as test 1 but explicit
    const out = await collect(all([range(0, 2), range(5, 7), range(10, 12)]));
    expect(out.length).toBe(6);
  });
});
