/**
 * Crypto Market Cap Tool — Free top-N rankings from CoinGecko.
 *
 * CoinGecko's `/coins/markets` is free, no API key, no auth required, with a
 * generous rate limit for casual use. Returns rank, price, market cap, 24h
 * change, volume, supply for the top N coins.
 *
 * Used by crypto-scanner / memecoin-scanner / crypto-analysis to anchor
 * scoring on real ranking data instead of LLM-imagined positions.
 */
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { safeFetch } from '../../utils/retry.js';

export const CRYPTO_MARKET_CAP_DESCRIPTION = `
Returns the top N cryptocurrencies by market capitalization from CoinGecko (free, no key).
Provides: rank, price (USD), market cap, 24h % change, 24h volume, circulating + max supply.
Use this BEFORE running crypto scoring so MCap rank is grounded in real data, not memory.
`.trim();

const CryptoMarketCapSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(250)
    .default(50)
    .describe('Number of coins to return (1–250). Defaults to 50.'),
  category: z
    .enum(['all', 'meme-token', 'layer-1', 'decentralized-finance-defi', 'artificial-intelligence', 'real-world-assets-rwa'])
    .optional()
    .describe(
      'Optional CoinGecko category filter. ' +
      'Use "meme-token" for memecoins, "layer-1" for L1s, "decentralized-finance-defi" for DeFi, ' +
      '"artificial-intelligence" for AI tokens, "real-world-assets-rwa" for RWA. Omit for the entire market.',
    ),
});

interface CoinGeckoCoin {
  id?: unknown;
  symbol?: unknown;
  name?: unknown;
  current_price?: unknown;
  market_cap?: unknown;
  market_cap_rank?: unknown;
  total_volume?: unknown;
  price_change_percentage_24h?: unknown;
  circulating_supply?: unknown;
  max_supply?: unknown;
  ath?: unknown;
  ath_change_percentage?: unknown;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export const cryptoMarketCapTool = new DynamicStructuredTool({
  name: 'crypto_market_cap',
  description:
    'Returns top N cryptocurrencies ranked by market cap from CoinGecko (free). Provides rank, price, market cap, 24h change, volume. Use to anchor crypto scoring on real ranking data.',
  schema: CryptoMarketCapSchema,
  func: async (input) => {
    try {
      const params = new URLSearchParams({
        vs_currency: 'usd',
        order: 'market_cap_desc',
        per_page: String(input.limit),
        page: '1',
        sparkline: 'false',
        price_change_percentage: '24h',
      });
      if (input.category && input.category !== 'all') {
        params.set('category', input.category);
      }
      const url = `https://api.coingecko.com/api/v3/coins/markets?${params.toString()}`;

      const resp = await safeFetch(
        url,
        { headers: { Accept: 'application/json', 'User-Agent': 'Alesia Financial Agent/1.0' } },
        { maxRetries: 1, baseDelayMs: 500, timeoutMs: 10_000 },
      );
      if (!resp.ok) {
        return formatToolResult(
          { error: `CoinGecko returned HTTP ${resp.status}`, category: input.category ?? 'all' },
          [url],
        );
      }
      const json = (await resp.json()) as CoinGeckoCoin[] | Record<string, unknown>;

      // CoinGecko returns either an array or an error object on rate-limit / 4xx.
      if (!Array.isArray(json)) {
        const errorMsg =
          typeof (json as Record<string, unknown>).error === 'string'
            ? ((json as Record<string, unknown>).error as string)
            : 'Unexpected response shape';
        return formatToolResult({ error: `CoinGecko error: ${errorMsg}` }, [url]);
      }

      const coins = json.map((coin) => ({
        rank: asNumber(coin.market_cap_rank),
        symbol: typeof coin.symbol === 'string' ? coin.symbol.toUpperCase() : null,
        name: asString(coin.name),
        priceUsd: asNumber(coin.current_price),
        marketCapUsd: asNumber(coin.market_cap),
        volume24hUsd: asNumber(coin.total_volume),
        change24hPct: asNumber(coin.price_change_percentage_24h),
        circulatingSupply: asNumber(coin.circulating_supply),
        maxSupply: asNumber(coin.max_supply),
        ath: asNumber(coin.ath),
        athChangePct: asNumber(coin.ath_change_percentage),
      }));

      return formatToolResult(
        {
          category: input.category ?? 'all',
          count: coins.length,
          asOf: new Date().toISOString(),
          coins,
        },
        [url, 'https://www.coingecko.com/'],
      );
    } catch (error) {
      return formatToolResult(
        { error: `Crypto market cap fetch failed: ${error instanceof Error ? error.message : String(error)}` },
        [],
      );
    }
  },
});
