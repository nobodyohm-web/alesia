/**
 * Binance USD-M Futures Tool — Derivatives positioning. Free, no API key.
 *
 * Spot price alone says "it went up". Funding, open interest and the
 * long/short ratio say whether leverage is building behind the move, which is
 * what distinguishes a squeeze from accumulation.
 */
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { USDMClient } from 'binance';
import { formatToolResult } from '../types.js';
import { withRetry, withTimeout, memoize } from '../../utils/retry.js';
import { TTL_15M } from './utils.js';

const futures = new USDMClient({});

// Same guard as binance.ts: the SDK takes no AbortSignal, so a stuck upstream
// would otherwise block the agent loop.
const FUTURES_TIMEOUT_MS = 10_000;
const fut = <T>(call: () => Promise<T>, label: string): Promise<T> =>
  withRetry(() => withTimeout(call(), FUTURES_TIMEOUT_MS, label), {
    maxRetries: 1,
    baseDelayMs: 400,
  });

export const BINANCE_FUTURES_DESCRIPTION = `
Fetches crypto derivatives positioning from Binance USD-M futures (free, no API key).

Returns for a perpetual pair (e.g. BTCUSDT, ETHUSDT, SOLUSDT):
- **Funding rate** — current and recent history. Positive = longs pay shorts (crowded long);
  persistently negative = crowded short. Charged every 8 hours.
- **Open interest** — total contracts outstanding and its trend. Rising OI with rising price
  = new money; rising OI with falling price = shorts building; falling OI = positions closing.
- **Long/short account ratio** — retail positioning, and the top-trader ratio for contrast.

Use it alongside binance_price whenever the question is about a move's quality, squeeze risk,
or leverage. Spot data alone cannot answer those.
`.trim();

const BinanceFuturesSchema = z.object({
  symbol: z.string().min(1).describe("Perpetual futures pair, e.g. 'BTCUSDT', 'ETHUSDT', 'SOLUSDT'"),
  period: z
    .enum(['5m', '15m', '1h', '4h', '1d'])
    .default('1d')
    .describe("Aggregation period for open interest and ratio history. Defaults to '1d'."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(30)
    .default(14)
    .describe('Number of historical points (1-30). Defaults to 14.'),
});

const toNum = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};

/**
 * Annualise a funding rate given its settlement interval.
 *
 * The interval is NOT always 8 hours. On Binance today, 126 of 208 perpetuals
 * settle every 4 hours and only 63 every 8 — BTC, ETH and SOL are 8h, but most
 * altcoins are not. Assuming 8h understates the annualised cost by exactly 2x
 * on the majority of pairs, which is the difference between "mild carry" and
 * "this position bleeds 30% a year".
 */
export function annualisedFunding(rate: number, intervalHours = 8): number {
  const settlementsPerDay = 24 / intervalHours;
  return Number((rate * settlementsPerDay * 365 * 100).toFixed(2));
}

/**
 * Recover the settlement interval from the spacing of funding timestamps.
 *
 * Binance exposes the interval only on a separate endpoint, but the history we
 * already fetch carries it implicitly. The median gap is used rather than the
 * mean so a single missed settlement cannot skew it.
 */
export function inferFundingIntervalHours(times: number[]): number {
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const hours = (times[i] - times[i - 1]) / 3_600_000;
    if (hours > 0.5 && hours <= 24) gaps.push(hours);
  }
  if (gaps.length === 0) return 8;
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  // Snap to the intervals exchanges actually use; anything else is a data gap.
  return [1, 2, 4, 8].reduce((best, candidate) =>
    Math.abs(candidate - median) < Math.abs(best - median) ? candidate : best,
  );
}

export const binanceFuturesTool = new DynamicStructuredTool({
  name: 'binance_futures_positioning',
  description:
    'Crypto derivatives positioning from Binance USD-M futures (free, no key): funding rate with annualised cost, open interest trend, and long/short account ratios. Use to judge leverage and squeeze risk behind a price move.',
  schema: BinanceFuturesSchema,
  func: async (input) => {
    const symbol = input.symbol.trim().toUpperCase();
    const sources = [`https://www.binance.com/en/futures/${symbol}`];

    try {
      // Funding settles every 8h and OI moves continuously; 15 min keeps a
      // multi-step scan on one upstream call without going stale.
      return await memoize(`binance_futures:${symbol}:${input.period}:${input.limit}`, TTL_15M, async () => {
        const [funding, openInterest, globalRatio, topRatio] = await Promise.all([
          fut(() => futures.getFundingRateHistory({ symbol, limit: input.limit }), `futures.funding ${symbol}`).catch(
            (e: unknown) => ({ __error: e instanceof Error ? e.message : String(e) }),
          ),
          fut(
            () => futures.getOpenInterestStatistics({ symbol, period: input.period, limit: input.limit }),
            `futures.oi ${symbol}`,
          ).catch((e: unknown) => ({ __error: e instanceof Error ? e.message : String(e) })),
          fut(
            () => futures.getGlobalLongShortAccountRatio({ symbol, period: input.period, limit: 1 }),
            `futures.globalRatio ${symbol}`,
          ).catch(() => null),
          fut(
            () => futures.getTopTradersLongShortPositionRatio({ symbol, period: input.period, limit: 1 }),
            `futures.topRatio ${symbol}`,
          ).catch(() => null),
        ]);

        // The SDK's typed rows carry no index signature; go through `unknown`
        // so the field projection below stays defensive rather than trusting
        // the SDK's shape.
        const fundingRows = Array.isArray(funding) ? (funding as unknown as Array<Record<string, unknown>>) : [];
        const oiRows = Array.isArray(openInterest) ? (openInterest as unknown as Array<Record<string, unknown>>) : [];

        if (fundingRows.length === 0 && oiRows.length === 0) {
          const reason =
            (funding as { __error?: string })?.__error ?? (openInterest as { __error?: string })?.__error ?? 'no data';
          return formatToolResult(
            { error: `No futures data for ${symbol} — check the pair exists as a USD-M perpetual (${reason})` },
            sources,
          );
        }

        // The SDK returns funding oldest-first; the latest is the last element.
        const latestFunding = toNum(fundingRows[fundingRows.length - 1]?.fundingRate);
        const avgFunding =
          fundingRows.length > 0
            ? fundingRows.reduce((sum, r) => sum + (toNum(r.fundingRate) ?? 0), 0) / fundingRows.length
            : null;

        const oiFirst = toNum(oiRows[0]?.sumOpenInterest);
        const oiLast = toNum(oiRows[oiRows.length - 1]?.sumOpenInterest);
        const oiChangePct =
          oiFirst !== null && oiLast !== null && oiFirst !== 0
            ? Number((((oiLast - oiFirst) / oiFirst) * 100).toFixed(2))
            : null;

        const ratioOf = (r: unknown): number | null =>
          Array.isArray(r) ? toNum((r[0] as Record<string, unknown> | undefined)?.longShortRatio) : null;

        const fundingTimes = fundingRows
          .map((r) => toNum(r.fundingTime))
          .filter((t): t is number => t !== null);
        const intervalHours = inferFundingIntervalHours(fundingTimes);

        return formatToolResult(
          {
            symbol,
            funding: {
              current: latestFunding,
              settlementIntervalHours: intervalHours,
              currentAnnualisedPercent:
                latestFunding !== null ? annualisedFunding(latestFunding, intervalHours) : null,
              averageAnnualisedPercent:
                avgFunding !== null ? annualisedFunding(avgFunding, intervalHours) : null,
              averageOverWindow: avgFunding !== null ? Number(avgFunding.toFixed(8)) : null,
              bias:
                latestFunding === null
                  ? null
                  : latestFunding > 0
                    ? 'longs pay shorts — crowded long'
                    : latestFunding < 0
                      ? 'shorts pay longs — crowded short'
                      : 'neutral',
              history: fundingRows.map((r) => ({
                time: toNum(r.fundingTime) !== null ? new Date(toNum(r.fundingTime) as number).toISOString() : null,
                rate: toNum(r.fundingRate),
              })),
            },
            openInterest: {
              latest: oiLast,
              latestValueUsd: toNum(oiRows[oiRows.length - 1]?.sumOpenInterestValue),
              changePercentOverWindow: oiChangePct,
              trend: oiChangePct === null ? null : oiChangePct > 0 ? 'building' : 'unwinding',
              history: oiRows.map((r) => ({
                time: toNum(r.timestamp) !== null ? new Date(toNum(r.timestamp) as number).toISOString() : null,
                openInterest: toNum(r.sumOpenInterest),
              })),
            },
            longShortRatio: {
              allAccounts: ratioOf(globalRatio),
              topTraderPositions: ratioOf(topRatio),
              note: 'Ratio > 1 = more longs than shorts. Divergence between retail (allAccounts) and topTraderPositions is the signal.',
            },
            period: input.period,
          },
          sources,
        );
      });
    } catch (error) {
      return formatToolResult(
        { error: `Binance futures failed for ${symbol}: ${error instanceof Error ? error.message : String(error)}` },
        sources,
      );
    }
  },
});
