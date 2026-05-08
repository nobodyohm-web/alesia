import { StructuredToolInterface } from '@langchain/core/tools';
import { createGetFinancials, createGetMarketData, createReadFilings, createScreenStocks } from './finance/index.js';
import { yahooQuoteTool, yahooHistoricalTool, yahooFinancialsTool, yahooKeyStatsTool, yahooSummaryTool, YAHOO_FINANCE_DESCRIPTION } from './finance/index.js';
import { binancePriceTool, binanceKlinesTool, binanceTopMoversTool, BINANCE_DESCRIPTION } from './finance/index.js';
import { ipoTrackerTool, IPO_TRACKER_DESCRIPTION } from './finance/index.js';
import { insiderDetectorTool, INSIDER_DETECTOR_DESCRIPTION } from './finance/index.js';
import { analystConsensusTool, ANALYST_CONSENSUS_DESCRIPTION } from './finance/index.js';
import { fearGreedTool, FEAR_GREED_DESCRIPTION } from './finance/index.js';
import { cryptoMarketCapTool, CRYPTO_MARKET_CAP_DESCRIPTION } from './finance/index.js';
import { sectorPerformanceTool, SECTOR_PERFORMANCE_DESCRIPTION } from './finance/index.js';
import { economicCalendarTool, ECONOMIC_CALENDAR_DESCRIPTION } from './finance/index.js';
import { rssIntelTool, RSS_INTELLIGENCE_DESCRIPTION } from './rss/rss-intel.js';
import { exaSearch, perplexitySearch, tavilySearch, WEB_SEARCH_DESCRIPTION, xSearchTool, X_SEARCH_DESCRIPTION } from './search/index.js';
import { skillTool, SKILL_TOOL_DESCRIPTION } from './skill.js';
import { webFetchTool, WEB_FETCH_DESCRIPTION } from './fetch/web-fetch.js';
import { browserTool, BROWSER_DESCRIPTION } from './browser/browser.js';
import { readFileTool, READ_FILE_DESCRIPTION } from './filesystem/read-file.js';
import { writeFileTool, WRITE_FILE_DESCRIPTION } from './filesystem/write-file.js';
import { editFileTool, EDIT_FILE_DESCRIPTION } from './filesystem/edit-file.js';
import { GET_FINANCIALS_DESCRIPTION } from './finance/get-financials.js';
import { GET_MARKET_DATA_DESCRIPTION } from './finance/get-market-data.js';
import { READ_FILINGS_DESCRIPTION } from './finance/read-filings.js';
import { SCREEN_STOCKS_DESCRIPTION } from './finance/screen-stocks.js';
import { heartbeatTool, HEARTBEAT_TOOL_DESCRIPTION } from './heartbeat/heartbeat-tool.js';
import { cronTool, CRON_TOOL_DESCRIPTION } from './cron/cron-tool.js';
import { memoryGetTool, MEMORY_GET_DESCRIPTION, memorySearchTool, MEMORY_SEARCH_DESCRIPTION, memoryUpdateTool, MEMORY_UPDATE_DESCRIPTION } from './memory/index.js';
import { discoverSkills } from '../skills/index.js';

/**
 * A registered tool with its rich description for system prompt injection.
 */
export interface RegisteredTool {
  /** Tool name (must match the tool's name property) */
  name: string;
  /** The actual tool instance */
  tool: StructuredToolInterface;
  /** Rich description for system prompt (includes when to use, when not to use, etc.) */
  description: string;
  /** 1-2 sentence description for token-optimized system prompts. */
  compactDescription: string;
  /** Whether this tool can safely execute concurrently with other concurrent-safe tools. */
  concurrencySafe: boolean;
}

/**
 * Get all registered tools with their descriptions.
 * Conditionally includes tools based on environment configuration.
 *
 * @param model - The model name (needed for tools that require model-specific configuration)
 * @returns Array of registered tools
 */
export function getToolRegistry(model: string): RegisteredTool[] {
  // Paid meta-tools require FINANCIAL_DATASETS_API_KEY. When missing, omit them
  // from the registry so the LLM can't waste turns calling tools that will throw.
  // The system prompt routes everything through Yahoo + Binance + RSS in that case.
  const hasFinancialDatasetsKey = Boolean(process.env.FINANCIAL_DATASETS_API_KEY);

  const tools: RegisteredTool[] = [];

  if (hasFinancialDatasetsKey) {
    tools.push(
      {
        name: 'get_financials',
        tool: createGetFinancials(model),
        description: GET_FINANCIALS_DESCRIPTION,
        compactDescription: 'Financial statements, metrics, and analyst estimates. Handles multi-company/multi-metric queries in one call.',
        concurrencySafe: true,
      },
      {
        name: 'get_market_data',
        tool: createGetMarketData(model),
        description: GET_MARKET_DATA_DESCRIPTION,
        compactDescription: 'Stock/crypto prices, company news, and insider trades. Handles multi-asset queries in one call.',
        concurrencySafe: true,
      },
      {
        name: 'read_filings',
        tool: createReadFilings(model),
        description: READ_FILINGS_DESCRIPTION,
        compactDescription: 'SEC filings (10-K, 10-Q, 8-K). Extracts and summarizes specific filing sections.',
        concurrencySafe: true,
      },
      {
        name: 'stock_screener',
        tool: createScreenStocks(model),
        description: SCREEN_STOCKS_DESCRIPTION,
        compactDescription: 'Screen stocks by financial criteria (P/E, growth, margins, etc.).',
        concurrencySafe: true,
      },
    );
  }

  tools.push(
    {
      name: 'web_fetch',
      tool: webFetchTool,
      description: WEB_FETCH_DESCRIPTION,
      compactDescription: 'Fetch and extract content from a URL as markdown. Use when you need full article text beyond headlines.',
      concurrencySafe: true,
    },
    {
      name: 'browser',
      tool: browserTool,
      description: BROWSER_DESCRIPTION,
      compactDescription: 'JavaScript-rendered pages and interactive navigation. Actions: navigate, snapshot, act, read, close.',
      // The browser tool keeps a global page + refs map. Running two browser
      // calls in parallel would race on that shared state.
      concurrencySafe: false,
    },
    {
      name: 'read_file',
      tool: readFileTool,
      description: READ_FILE_DESCRIPTION,
      compactDescription: 'Read a local file by path. Returns file content as text.',
      concurrencySafe: true,
    },
    {
      name: 'write_file',
      tool: writeFileTool,
      description: WRITE_FILE_DESCRIPTION,
      compactDescription: 'Create or overwrite a file. Requires user approval.',
      concurrencySafe: false,
    },
    {
      name: 'edit_file',
      tool: editFileTool,
      description: EDIT_FILE_DESCRIPTION,
      compactDescription: 'Edit a file by replacing text. Requires user approval.',
      concurrencySafe: false,
    },
    {
      name: 'heartbeat',
      tool: heartbeatTool,
      description: HEARTBEAT_TOOL_DESCRIPTION,
      compactDescription: 'View or update the periodic heartbeat checklist (.alesia/HEARTBEAT.md).',
      concurrencySafe: true,
    },
    {
      name: 'cron',
      tool: cronTool,
      description: CRON_TOOL_DESCRIPTION,
      compactDescription: 'Manage scheduled cron jobs (create, list, update, delete).',
      concurrencySafe: true,
    },
    {
      name: 'memory_search',
      tool: memorySearchTool,
      description: MEMORY_SEARCH_DESCRIPTION,
      compactDescription: 'Search persistent memory and past conversations for stored facts and preferences.',
      concurrencySafe: true,
    },
    {
      name: 'memory_get',
      tool: memoryGetTool,
      description: MEMORY_GET_DESCRIPTION,
      compactDescription: 'Read specific memory file sections by line range.',
      concurrencySafe: true,
    },
    {
      name: 'memory_update',
      tool: memoryUpdateTool,
      description: MEMORY_UPDATE_DESCRIPTION,
      compactDescription: 'Add, edit, or delete persistent memory entries.',
      concurrencySafe: false,
    },
    // === Yahoo Finance Tools (FREE — No API key required) ===
    {
      name: 'yahoo_quote',
      tool: yahooQuoteTool,
      description: YAHOO_FINANCE_DESCRIPTION,
      compactDescription: 'Free real-time stock quote from Yahoo Finance. Price, P/E, EPS, 52-week range, market cap.',
      concurrencySafe: true,
    },
    {
      name: 'yahoo_historical',
      tool: yahooHistoricalTool,
      description: YAHOO_FINANCE_DESCRIPTION,
      compactDescription: 'Free historical OHLCV data from Yahoo Finance. Daily/weekly/monthly candlesticks.',
      concurrencySafe: true,
    },
    {
      name: 'yahoo_financials',
      tool: yahooFinancialsTool,
      description: YAHOO_FINANCE_DESCRIPTION,
      compactDescription: 'Free income statements, balance sheets, cash flow from Yahoo Finance.',
      concurrencySafe: true,
    },
    {
      name: 'yahoo_key_stats',
      tool: yahooKeyStatsTool,
      description: YAHOO_FINANCE_DESCRIPTION,
      compactDescription: 'Free key statistics: P/E, PEG, P/B, EV/EBITDA, margins, ROE, debt ratios from Yahoo Finance.',
      concurrencySafe: true,
    },
    {
      name: 'yahoo_summary',
      tool: yahooSummaryTool,
      description: YAHOO_FINANCE_DESCRIPTION,
      compactDescription: 'PREFERRED: Fetches ALL financial data in ONE call (quote + stats + 3 statements). Saves 3 tool calls vs separate tools.',
      concurrencySafe: true,
    },
    // === Binance Tools (FREE — No API key required) ===
    {
      name: 'binance_price',
      tool: binancePriceTool,
      description: BINANCE_DESCRIPTION,
      compactDescription: 'Free real-time crypto price and 24h stats from Binance.',
      concurrencySafe: true,
    },
    {
      name: 'binance_klines',
      tool: binanceKlinesTool,
      description: BINANCE_DESCRIPTION,
      compactDescription: 'Free historical crypto candlestick (OHLCV) data from Binance.',
      concurrencySafe: true,
    },
    {
      name: 'binance_top_movers',
      tool: binanceTopMoversTool,
      description: BINANCE_DESCRIPTION,
      compactDescription: 'Free top gaining/losing crypto pairs on Binance in last 24h.',
      concurrencySafe: true,
    },
    // === IPO Tracker (FREE — No API key required) ===
    {
      name: 'ipo_tracker',
      tool: ipoTrackerTool,
      description: IPO_TRACKER_DESCRIPTION,
      compactDescription: 'Track upcoming and recent IPOs from SEC EDGAR and Nasdaq (free).',
      concurrencySafe: true,
    },
    // === Insider Trading Detector (FREE — Yahoo + SEC) ===
    {
      name: 'insider_detector',
      tool: insiderDetectorTool,
      description: INSIDER_DETECTOR_DESCRIPTION,
      compactDescription: 'Detects material insider buys/sells (>$1M) for a ticker. Returns BULLISH/BEARISH/NEUTRAL verdict + transaction list.',
      concurrencySafe: true,
    },
    // === Analyst Consensus (FREE — Yahoo) ===
    {
      name: 'analyst_consensus',
      tool: analystConsensusTool,
      description: ANALYST_CONSENSUS_DESCRIPTION,
      compactDescription: 'Wall Street consensus: strongBuy/buy/hold/sell/strongSell breakdown, mean rating, target prices, recent upgrades/downgrades.',
      concurrencySafe: true,
    },
    // === Fear & Greed Index (FREE — alternative.me) ===
    {
      name: 'fear_greed_index',
      tool: fearGreedTool,
      description: FEAR_GREED_DESCRIPTION,
      compactDescription: 'Crypto Fear & Greed Index (0–100). Free, no API key. Use in crypto/memecoin scanners to gauge sentiment.',
      concurrencySafe: true,
    },
    // === Crypto Market Cap (FREE — CoinGecko) ===
    {
      name: 'crypto_market_cap',
      tool: cryptoMarketCapTool,
      description: CRYPTO_MARKET_CAP_DESCRIPTION,
      compactDescription: 'Top N cryptos by market cap from CoinGecko (free). Use BEFORE crypto scoring to anchor MCap rank in real data.',
      concurrencySafe: true,
    },
    // === Sector Performance (FREE — Yahoo via 11 GICS ETFs) ===
    {
      name: 'sector_performance',
      tool: sectorPerformanceTool,
      description: SECTOR_PERFORMANCE_DESCRIPTION,
      compactDescription: 'Snapshot of 11 S&P GICS sector ETFs + SPY/QQQ/IWM in one call. For macro-radar and sector rotation analysis.',
      concurrencySafe: true,
    },
    // === Economic Calendar (FREE — Trading Economics guest endpoint) ===
    {
      name: 'economic_calendar',
      tool: economicCalendarTool,
      description: ECONOMIC_CALENDAR_DESCRIPTION,
      compactDescription: 'Upcoming high-impact macro events (FOMC, CPI, NFP, GDP, PCE) for the next N days. Free.',
      concurrencySafe: true,
    },
    // === RSS Intelligence (FREE — No API key required) ===
    {
      name: 'rss_intelligence',
      tool: rssIntelTool,
      description: RSS_INTELLIGENCE_DESCRIPTION,
      compactDescription: 'Scan SEC EDGAR + Google News + GlobeNewsWire RSS feeds for latest news, filings, and press releases about any company or topic (free).',
      concurrencySafe: true,
    },
  );

  // Include web_search if Exa, Perplexity, or Tavily API key is configured (Exa → Perplexity → Tavily)
  if (process.env.EXASEARCH_API_KEY) {
    tools.push({
      name: 'web_search',
      tool: exaSearch,
      description: WEB_SEARCH_DESCRIPTION,
      compactDescription: 'Search the web for current information. Returns titles, URLs, and highlights.',
      concurrencySafe: true,
    });
  } else if (process.env.PERPLEXITY_API_KEY) {
    tools.push({
      name: 'web_search',
      tool: perplexitySearch,
      description: WEB_SEARCH_DESCRIPTION,
      compactDescription: 'Search the web for current information. Returns an answer with citations.',
      concurrencySafe: true,
    });
  } else if (process.env.TAVILY_API_KEY) {
    tools.push({
      name: 'web_search',
      tool: tavilySearch,
      description: WEB_SEARCH_DESCRIPTION,
      compactDescription: 'Search the web for current information. Returns titles, URLs, and snippets.',
      concurrencySafe: true,
    });
  }

  if (process.env.X_BEARER_TOKEN) {
    tools.push({
      name: 'x_search',
      tool: xSearchTool,
      description: X_SEARCH_DESCRIPTION,
      compactDescription: 'Search X/Twitter for tweets, profiles, and threads.',
      concurrencySafe: true,
    });
  }

  const availableSkills = discoverSkills();
  if (availableSkills.length > 0) {
    tools.push({
      name: 'skill',
      tool: skillTool,
      description: SKILL_TOOL_DESCRIPTION,
      compactDescription: 'Invoke a specialized skill workflow (e.g., DCF valuation).',
      concurrencySafe: false,
    });
  }

  return tools;
}

/**
 * Build a name → concurrencySafe map for the tool executor.
 */
export function getToolConcurrencyMap(model: string): Map<string, boolean> {
  return new Map(getToolRegistry(model).map(t => [t.name, t.concurrencySafe]));
}

/**
 * Get just the tool instances for binding to the LLM.
 *
 * @param model - The model name
 * @returns Array of tool instances
 */
export function getTools(model: string): StructuredToolInterface[] {
  return getToolRegistry(model).map((t) => t.tool);
}

/**
 * Build the tool descriptions section for the system prompt.
 * Formats each tool's rich description with a header.
 *
 * @param model - The model name
 * @returns Formatted string with all tool descriptions
 */
/**
 * Build compact tool descriptions for token-optimized system prompts.
 * Uses 1-2 sentence descriptions instead of full multi-paragraph ones.
 * The LLM already has full tool schemas via bindTools().
 */
export function buildCompactToolDescriptions(model: string): string {
  return getToolRegistry(model)
    .map((t) => `- **${t.name}**: ${t.compactDescription}`)
    .join('\n');
}
