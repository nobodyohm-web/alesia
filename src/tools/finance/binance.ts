/**
 * Binance Tools — Free crypto market data (no API key required).
 * All tools wrapped with try/catch for production resilience.
 */
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { MainClient } from 'binance';
import { formatToolResult } from '../types.js';
import { withRetry, withTimeout, memoize } from '../../utils/retry.js';

const binance = new MainClient({});

// Hard timeout for every Binance SDK call. The SDK doesn't accept an
// AbortSignal so a stuck upstream would otherwise block the agent loop.
const BINANCE_TIMEOUT_MS = 10_000;
const bn = <T>(call: () => Promise<T>, label: string): Promise<T> =>
  withRetry(() => withTimeout(call(), BINANCE_TIMEOUT_MS, label), {
    maxRetries: 1,
    baseDelayMs: 400,
  });

export const BINANCE_DESCRIPTION = `
Fetches free cryptocurrency market data directly from the Binance exchange.
No API key required. Provides: real-time prices, 24h stats, historical candlesticks (klines), and top movers.
Supports all trading pairs on Binance (e.g., BTCUSDT, ETHUSDT, SOLUSDT).
`.trim();

const BinancePriceSchema = z.object({
  symbol: z.string().min(1).describe("Trading pair symbol, e.g. 'BTCUSDT', 'ETHUSDT', 'SOLUSDT'"),
});

export const binancePriceTool = new DynamicStructuredTool({
  name: 'binance_price',
  description:
    'Fetches real-time price and 24h stats for a crypto pair from Binance (free). Returns price, 24h change %, high/low, volume.',
  schema: BinancePriceSchema,
  func: async (input) => {
    const symbol = input.symbol.trim().toUpperCase();
    try {
      // 60-second memo: scanners often call binance_price 3-5× per run for
      // the same pair (initial probe → scoring → entry levels).
      return await memoize(`binance_price:${symbol}`, 60_000, async () => {
        const ticker = await bn(
          () => binance.get24hrChangeStatistics({ symbol }),
          `binance.24hr ${symbol}`,
        );
        const data = (Array.isArray(ticker) ? ticker[0] : ticker) as Record<string, unknown>;
        return formatToolResult({
          symbol: data.symbol, price: data.lastPrice,
          priceChange24h: data.priceChange, priceChangePercent24h: data.priceChangePercent,
          high24h: data.highPrice, low24h: data.lowPrice,
          volume24h: data.volume, quoteVolume24h: data.quoteVolume,
        }, [`https://www.binance.com/trade/${symbol}`]);
      });
    } catch (error) {
      return formatToolResult({ error: `Binance price failed for ${symbol}: ${error instanceof Error ? error.message : String(error)}` }, []);
    }
  },
});

const BinanceKlinesSchema = z.object({
  symbol: z.string().min(1).describe("Trading pair symbol, e.g. 'BTCUSDT'"),
  interval: z.enum(['1m', '5m', '15m', '1h', '4h', '1d', '1w', '1M']).default('1d')
    .describe("Candlestick interval. Defaults to '1d'."),
  // CLAUDE.md token budget: ~1200 tokens → 60 candles max for short scans.
  // The schema still allows up to 200 for the rare deep-history case.
  limit: z.number().int().min(1).max(200).default(60).describe('Number of candles (1-200). Defaults to 60 (fits the token budget).'),
});

export const binanceKlinesTool = new DynamicStructuredTool({
  name: 'binance_klines',
  description:
    'Fetches historical OHLCV candlestick data from Binance (free). For technical analysis.',
  schema: BinanceKlinesSchema,
  func: async (input) => {
    const symbol = input.symbol.trim().toUpperCase();
    try {
      const klines = await bn(
        () => binance.getKlines({ symbol, interval: input.interval, limit: Math.min(input.limit, 200) }),
        `binance.klines ${symbol}`,
      );
      // closeTime is fully derivable from openTime+interval; dropping it saves
      // ~30 chars per candle (≈1.8K chars per 60-candle response).
      const candles = klines.map((k: unknown[]) => ({
        openTime: new Date(k[0] as number).toISOString(),
        open: k[1], high: k[2], low: k[3], close: k[4], volume: k[5],
      }));
      return formatToolResult(candles, [`https://www.binance.com/trade/${symbol}`]);
    } catch (error) {
      return formatToolResult({ error: `Binance klines failed for ${symbol}: ${error instanceof Error ? error.message : String(error)}` }, []);
    }
  },
});

const BinanceTopMoversSchema = z.object({
  direction: z.enum(['gainers', 'losers']).default('gainers')
    .describe("'gainers' for top risers, 'losers' for top fallers"),
  limit: z.number().int().min(1).max(100).default(10).describe("Number of results (1-100). Defaults to 10."),
});

export const binanceTopMoversTool = new DynamicStructuredTool({
  name: 'binance_top_movers',
  description:
    'Fetches top gaining or losing crypto pairs on Binance in the last 24h (free). For momentum plays.',
  schema: BinanceTopMoversSchema,
  func: async (input) => {
    try {
      // get24hrChangeStatistics with no symbol returns all ~2000 pairs.
      // Memoize for 60s so the gainers/losers flips share one upstream call.
      const allTickers = await memoize('binance_all_tickers', 60_000, () =>
        bn(() => binance.get24hrChangeStatistics(), 'binance.24hr-all'),
      );
      const usdtPairs = (allTickers as unknown as Array<Record<string, string>>)
        .filter((t) => t.symbol?.endsWith('USDT'))
        .map((t) => ({
          symbol: t.symbol, price: t.lastPrice,
          changePercent: parseFloat(t.priceChangePercent || '0'),
          volume: t.quoteVolume,
        }))
        .sort((a, b) =>
          input.direction === 'gainers' ? b.changePercent - a.changePercent : a.changePercent - b.changePercent
        )
        .slice(0, Math.min(input.limit, 25));
      return formatToolResult(usdtPairs, ['https://www.binance.com/markets']);
    } catch (error) {
      return formatToolResult({ error: `Binance top movers failed: ${error instanceof Error ? error.message : String(error)}` }, []);
    }
  },
});
