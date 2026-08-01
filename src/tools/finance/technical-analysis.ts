/**
 * Technical analysis tool — the multi-timeframe read of any market.
 *
 * Where `trade_setup` answers "what do I do", this answers "what is actually
 * happening". It exists separately because the honest answer to a lot of
 * questions is a description of the state rather than a trade, and because a
 * setup should be auditable against the raw read that produced it.
 *
 * Works identically on equities and crypto.
 */
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { getCandles, type Market, type Timeframe } from './candles.js';
import { analyzeTimeframe } from './market-read.js';
import { correlation, beta, round } from './indicators.js';

const TechnicalAnalysisSchema = z.object({
  symbol: z.string().min(1).describe("Ticker or pair, e.g. 'NVDA', 'AAPL', 'BTC', 'ETHUSDT'"),
  timeframes: z
    .array(z.enum(['5m', '15m', '1h', '4h', '1d', '1wk']))
    .min(1)
    .max(4)
    .default(['1d'])
    .describe(
      "Timeframes to analyse. Multiple timeframes reveal alignment or conflict, which matters more than any single reading. Defaults to ['1d'].",
    ),
  market: z.enum(['auto', 'equity', 'crypto']).default('auto').describe("Venue. 'auto' infers it from the symbol."),
  benchmark: z
    .string()
    .optional()
    .describe("Optional symbol to measure correlation and beta against, e.g. 'SPY', '^GSPC', 'BTCUSDT'."),
});

export const TECHNICAL_ANALYSIS_DESCRIPTION = `
Reads the technical state of any stock or crypto pair across one or more timeframes.

Returns per timeframe:
- **Trend** — direction, ADX strength, EMA20/50/200 with price distance, golden/death regime,
  regression slope, and swing structure (higher-highs/higher-lows or the reverse).
- **Momentum** — RSI with its value 5 bars ago, MACD and its cross, Stochastic RSI, rate of change.
- **Volatility** — ATR in points and percent, Bollinger bandwidth, %B, squeeze state and whether a
  squeeze just released, annualised realised volatility, max drawdown.
- **Volume** — relative volume, OBV accumulation/distribution, Money Flow Index, VWAP and distance to it.
- **Levels** — clustered support and resistance ranked by touches and recency, distance in ATR,
  Donchian range with the position inside it, and floor-trader pivots.
- **Divergences** — regular and hidden, price against RSI.
- **Signals** — plain-language observations, each traceable to a number above.

Optionally computes correlation and beta against a benchmark.

Use it whenever a question is about a chart, a trend, an entry level, momentum, volatility, or a
support/resistance level. Never state a technical level from memory — read it here.
`.trim();

export const technicalAnalysisTool = new DynamicStructuredTool({
  name: 'technical_analysis',
  description:
    'Multi-timeframe technical read of a stock or crypto pair: trend and ADX, EMA structure, RSI/MACD/StochRSI momentum, ATR and Bollinger volatility with squeeze detection, volume and OBV, clustered support/resistance levels, pivots, and RSI divergences. Optionally correlation and beta vs a benchmark. Use for any chart, level, trend or momentum question.',
  schema: TechnicalAnalysisSchema,
  func: async (input) => {
    const sources: string[] = [];
    try {
      // 260 bars covers EMA200 on every timeframe while staying inside
      // Binance's single-request limit and Yahoo's intraday window.
      const BARS = 260;
      const timeframes = input.timeframes as Timeframe[];

      const sets = await Promise.all(
        timeframes.map((tf) => getCandles(input.symbol, tf, BARS, input.market as Market)),
      );

      const resolved = sets[0].resolved;
      sources.push(
        resolved.market === 'crypto'
          ? `https://www.binance.com/trade/${resolved.symbol}`
          : `https://finance.yahoo.com/quote/${resolved.symbol}`,
      );

      const analyses: Record<string, unknown> = {};
      let anyRead = false;
      for (const set of sets) {
        const read = analyzeTimeframe(set.candles, set.barsPerYear);
        if (read) {
          anyRead = true;
          analyses[set.timeframe] = read;
        } else {
          analyses[set.timeframe] = {
            error: `Only ${set.candles.length} bars available — need 30+ for a meaningful read.`,
          };
        }
      }

      if (!anyRead) {
        return formatToolResult(
          {
            error: `No usable price history for ${resolved.symbol} on ${timeframes.join(', ')}.`,
            hint:
              resolved.market === 'equity'
                ? 'Yahoo serves only ~55 days of intraday history and nothing for delisted symbols. Try a daily or weekly timeframe.'
                : 'Check the pair exists on Binance (it needs the quote asset, e.g. BTCUSDT).',
          },
          sources,
        );
      }

      // --- Cross-timeframe alignment ---------------------------------------
      // The single most useful derived fact: when every timeframe agrees, a
      // trade is high-probability. When they conflict, the honest answer is
      // usually to wait rather than to pick one.
      const directions = timeframes
        .map((tf) => {
          const a = analyses[tf] as { trend?: { direction?: string } };
          return a?.trend?.direction;
        })
        .filter((d): d is string => Boolean(d));

      const allUp = directions.length > 1 && directions.every((d) => d === 'up');
      const allDown = directions.length > 1 && directions.every((d) => d === 'down');
      const alignment =
        directions.length < 2
          ? null
          : {
              aligned: allUp || allDown,
              direction: allUp ? 'up' : allDown ? 'down' : 'mixed',
              perTimeframe: Object.fromEntries(timeframes.map((tf, i) => [tf, directions[i] ?? 'unknown'])),
              interpretation: allUp
                ? 'Every timeframe points up — pullbacks are buyable, and shorts are fighting the whole structure.'
                : allDown
                  ? 'Every timeframe points down — rallies are sellable, and longs are fighting the whole structure.'
                  : 'Timeframes disagree. The higher timeframe wins on bias; the lower one only decides timing. Conflict usually means wait.',
            };

      // --- Benchmark relationship ------------------------------------------
      let relative: Record<string, unknown> | null = null;
      if (input.benchmark) {
        try {
          const daily = sets.find((s) => s.timeframe === '1d') ?? sets[0];
          const bench = await getCandles(input.benchmark, daily.timeframe, BARS, 'auto');
          const n = Math.min(daily.candles.length, bench.candles.length);
          if (n >= 30) {
            const a = daily.candles.slice(-n).map((c) => c.close);
            const b = bench.candles.slice(-n).map((c) => c.close);
            const corr = correlation(a, b);
            const bta = beta(a, b);
            const assetReturn = ((a[a.length - 1] - a[0]) / a[0]) * 100;
            const benchReturn = ((b[b.length - 1] - b[0]) / b[0]) * 100;
            relative = {
              benchmark: bench.resolved.symbol,
              timeframe: daily.timeframe,
              bars: n,
              correlation: corr !== null ? round(corr, 3) : null,
              beta: bta !== null ? round(bta, 3) : null,
              assetReturnPercent: round(assetReturn, 2),
              benchmarkReturnPercent: round(benchReturn, 2),
              relativeStrength: round(assetReturn - benchReturn, 2),
              note:
                bta !== null && bta > 1.3
                  ? 'High beta — moves are amplified versions of the benchmark, in both directions.'
                  : bta !== null && bta < 0.7
                    ? 'Low beta — moves are damped relative to the benchmark; this is a defensive profile.'
                    : 'Beta near 1 — this largely tracks the benchmark.',
            };
          }
        } catch {
          // A benchmark failure must not lose the primary analysis.
          relative = { benchmark: input.benchmark, error: 'Benchmark data unavailable.' };
        }
      }

      return formatToolResult(
        {
          symbol: resolved.symbol,
          market: resolved.market,
          timeframes,
          alignment,
          analyses,
          relative,
          note: 'All levels are computed from the actual candle series. Support and resistance are ranked by number of touches and recency; distances are given in ATR so they are comparable across instruments.',
        },
        sources,
      );
    } catch (error) {
      return formatToolResult(
        { error: `Technical analysis failed for ${input.symbol}: ${error instanceof Error ? error.message : String(error)}` },
        sources,
      );
    }
  },
});
