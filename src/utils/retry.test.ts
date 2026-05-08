import { describe, test, expect } from 'bun:test';
import { withRetry, withTimeout, memoize, clearMemoCache } from './retry.js';

describe('withRetry', () => {
  test('returns the value on first success without retrying', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls += 1;
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(calls).toBe(1);
  });

  test('retries after a transient failure and eventually succeeds', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 2) throw new Error('Server error 503: temporary');
        return 'recovered';
      },
      { maxRetries: 3, baseDelayMs: 1 }
    );
    expect(result).toBe('recovered');
    expect(calls).toBe(2);
  });

  test('does not retry on 4xx client errors', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error('Server returned 404 Not Found');
        },
        { maxRetries: 3, baseDelayMs: 1 }
      )
    ).rejects.toThrow(/404/);
    expect(calls).toBe(1);
  });

  test('does not retry on 401 / 403 / 429 client errors', async () => {
    for (const code of [401, 403, 429]) {
      let calls = 0;
      await expect(
        withRetry(
          async () => {
            calls += 1;
            throw new Error(`HTTP ${code} client error`);
          },
          { maxRetries: 3, baseDelayMs: 1 }
        )
      ).rejects.toThrow();
      expect(calls).toBe(1);
    }
  });

  test('respects maxRetries and rethrows the final error', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error('network unreachable');
        },
        { maxRetries: 2, baseDelayMs: 1 }
      )
    ).rejects.toThrow(/network unreachable/);
    // initial attempt + 2 retries = 3 total invocations
    expect(calls).toBe(3);
  });

  test('uses default maxRetries=2 when no options are provided', async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls += 1;
        throw new Error('boom');
      })
    ).rejects.toThrow(/boom/);
    expect(calls).toBe(3); // 1 initial + 2 retries
  });

  test('applies exponential backoff between attempts', async () => {
    let calls = 0;
    const start = Date.now();
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error('still failing');
        },
        { maxRetries: 2, baseDelayMs: 50 }
      )
    ).rejects.toThrow();
    const elapsed = Date.now() - start;
    // Backoff: ~50ms after attempt 0, ~100ms after attempt 1.
    // We allow generous slack for jitter and CI flakiness.
    expect(elapsed).toBeGreaterThanOrEqual(140);
    expect(calls).toBe(3);
  });
});

describe('withTimeout', () => {
  test('resolves with the inner value when the promise settles in time', async () => {
    const out = await withTimeout(Promise.resolve(42), 100);
    expect(out).toBe(42);
  });

  test('rejects with a timeout error if the promise hangs past the deadline', async () => {
    await expect(
      withTimeout(new Promise(() => {}), 50, 'hang-test'),
    ).rejects.toThrow(/hang-test timed out after 50ms/);
  });

  test('does not leak the timer when the inner promise resolves first', async () => {
    // If the timer were leaking we'd be racing it on every call. This
    // assertion is implicit — we just verify the function returns promptly.
    const start = Date.now();
    await withTimeout(Promise.resolve('quick'), 10_000);
    expect(Date.now() - start).toBeLessThan(50);
  });
});

describe('memoize', () => {
  test('returns the cached value within the TTL window', async () => {
    clearMemoCache();
    let calls = 0;
    const fn = async () => {
      calls += 1;
      return calls;
    };
    const a = await memoize('memo:a', 10_000, fn);
    const b = await memoize('memo:a', 10_000, fn);
    expect(a).toBe(1);
    expect(b).toBe(1); // cached
    expect(calls).toBe(1);
  });

  test('refreshes the value once the TTL expires', async () => {
    clearMemoCache();
    let calls = 0;
    const fn = async () => ++calls;
    await memoize('memo:b', 5, fn);
    await new Promise((r) => setTimeout(r, 15));
    const after = await memoize('memo:b', 5, fn);
    expect(after).toBe(2);
    expect(calls).toBe(2);
  });

  test('separates cache entries by key', async () => {
    clearMemoCache();
    let calls = 0;
    const fn = async () => ++calls;
    await memoize('memo:c1', 10_000, fn);
    await memoize('memo:c2', 10_000, fn);
    expect(calls).toBe(2);
  });
});
