/**
 * Shared retry/timeout/cache utilities for all external API calls.
 * Used by yahoo.ts, binance.ts, rss-intel.ts, ipo-tracker.ts, etc.
 */

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 2,
  baseDelayMs: 1000,
  timeoutMs: 10000,
};

/**
 * Wraps an arbitrary promise with a hard timeout. Used for SDK calls
 * (yahoo-finance2, binance) that don't accept an AbortSignal so a hung
 * upstream can't block the agent loop.
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label?: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label ?? 'operation'} timed out after ${ms}ms`)),
      ms,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * In-memory TTL memoizer. Used to dedupe high-frequency tool calls within
 * a single skill run (e.g. crypto-scanner calling fear_greed_index 3×).
 * Persistent caching is handled by utils/cache.ts at the API layer.
 */
const memoStore = new Map<string, { expires: number; value: unknown }>();

export async function memoize<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const hit = memoStore.get(key);
  if (hit && hit.expires > now) return hit.value as T;
  const value = await fn();
  memoStore.set(key, { value, expires: now + ttlMs });
  // Opportunistic eviction: drop expired entries when the map gets large
  // to prevent unbounded growth in long-lived processes.
  if (memoStore.size > 256) {
    for (const [k, v] of memoStore) {
      if (v.expires <= now) memoStore.delete(k);
    }
  }
  return value;
}

export function clearMemoCache(): void {
  memoStore.clear();
}

/**
 * Wraps an async function with retry logic and exponential backoff.
 * Only retries on transient errors (network, 5xx). Never retries 4xx.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: RetryOptions,
): Promise<T> {
  const { maxRetries, baseDelayMs } = { ...DEFAULT_OPTIONS, ...opts };

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry client errors (4xx)
      if (error instanceof Error && /4\d{2}/.test(error.message)) {
        throw error;
      }

      // Don't retry on last attempt
      if (attempt === maxRetries) break;

      // Exponential backoff with jitter
      const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 500;
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError;
}

/**
 * Safe fetch wrapper: fetch with timeout + retry.
 */
export async function safeFetch(
  url: string,
  init?: RequestInit,
  opts?: RetryOptions,
): Promise<Response> {
  const { timeoutMs } = { ...DEFAULT_OPTIONS, ...opts };

  return withRetry(async () => {
    const resp = await fetch(url, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
    });
    if (resp.status >= 500) {
      throw new Error(`Server error ${resp.status} from ${new URL(url).hostname}`);
    }
    return resp;
  }, opts);
}
