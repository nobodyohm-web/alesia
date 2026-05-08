/**
 * Microcompact: per-turn lightweight trimming of old ToolMessage content.
 *
 * Unlike full compaction (which calls an LLM to summarize), microcompact
 * simply replaces old ToolMessage content with a cleared marker. This
 * prevents context from growing to the full compaction threshold.
 *
 * Lightweight alternative to full compaction.
 */

import { ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { getEffectiveContextWindow } from '../utils/tokens.js';

/** Marker text replacing cleared tool results. */
export const MC_CLEARED_MESSAGE = '[Old tool result content cleared]';

/** Fire when compactable ToolMessages exceed this count. */
export const COUNT_TRIGGER_THRESHOLD = 8;

/** Keep this many most recent compactable ToolMessages. */
export const COUNT_KEEP_RECENT = 4;

/**
 * Default token trigger for callers that don't pass a model. Sized for a
 * 200K Anthropic window — for smaller models, pass the model name and we'll
 * scale to 75% of the effective context.
 */
export const DEFAULT_TOKEN_TRIGGER_THRESHOLD = 80_000;

/**
 * Minimum size below which microcompact's token trigger never fires —
 * if the model genuinely has 4K of context, the count trigger is the right tool.
 */
const MIN_TOKEN_TRIGGER_THRESHOLD = 8_000;

/**
 * Tool names whose results can be safely cleared (read-only tools).
 *
 * Includes:
 *   - Paid meta-tools (`get_financials`, `get_market_data`, `read_filings`, `stock_screener`)
 *   - All free Yahoo / Binance / IPO / insider / analyst / fear-greed tools
 *   - RSS intelligence
 *   - Web tools (`web_search`, `web_fetch`, `x_search`, `browser`)
 *   - Filesystem read tool
 *   - Memory + heartbeat + cron utility tools
 *
 * Tools NOT in this set: `skill`, `write_file`, `edit_file`, `memory_update` —
 * either side-effecting or carrying instructions that the agent must keep.
 */
const COMPACTABLE_TOOLS = new Set([
  // Paid meta-tools
  'get_financials',
  'get_market_data',
  'read_filings',
  'stock_screener',
  // Yahoo Finance (free)
  'yahoo_quote',
  'yahoo_historical',
  'yahoo_financials',
  'yahoo_key_stats',
  'yahoo_summary',
  // Binance (free)
  'binance_price',
  'binance_klines',
  'binance_top_movers',
  // Other free finance
  'ipo_tracker',
  'insider_detector',
  'analyst_consensus',
  'fear_greed_index',
  // News + web
  'rss_intelligence',
  'web_fetch',
  'web_search',
  'x_search',
  'browser',
  // Utilities
  'read_file',
  'memory_search',
  'memory_get',
  'heartbeat',
  'cron',
]);

export interface MicrocompactResult {
  messages: BaseMessage[];
  /** Number of ToolMessages whose content was cleared. */
  cleared: number;
  /** Estimated tokens saved by clearing. */
  estimatedTokensSaved: number;
  /** Which trigger fired, or null if nothing was cleared. */
  trigger: 'count' | 'token' | null;
}

/**
 * Compute the model-aware token trigger threshold.
 *
 * Aim for ~75% of the effective context window — by the time we'd hit that
 * level, microcompact should have fired and saved enough room to delay full
 * compaction. Clamped to a sane floor to avoid spuriously firing on tiny windows.
 */
export function getTokenTriggerThreshold(model?: string): number {
  if (!model) return DEFAULT_TOKEN_TRIGGER_THRESHOLD;
  const effective = getEffectiveContextWindow(model);
  return Math.max(MIN_TOKEN_TRIGGER_THRESHOLD, Math.floor(effective * 0.75));
}

/**
 * Per-turn lightweight trimming of old ToolMessage content.
 *
 * Count-based: when total compactable ToolMessages exceed the threshold,
 * replace the oldest ones' content with a cleared marker, keeping the
 * most recent N.
 *
 * Token-based: when the cumulative compactable ToolMessage payload exceeds
 * `getTokenTriggerThreshold(model)`, fire the same clearing.
 *
 * Returns a new array if changes were made; returns the original if not.
 */
export function microcompactMessages(
  messages: BaseMessage[],
  model?: string,
): MicrocompactResult {
  // Collect indices of compactable ToolMessages with real content
  const compactableIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (
      msg instanceof ToolMessage &&
      COMPACTABLE_TOOLS.has(msg.name ?? '') &&
      typeof msg.content === 'string' &&
      msg.content !== MC_CLEARED_MESSAGE
    ) {
      compactableIndices.push(i);
    }
  }

  // Check count-based trigger
  const countTriggered = compactableIndices.length > COUNT_TRIGGER_THRESHOLD;

  // Check token-based trigger (catches few-but-large results)
  const tokenThreshold = getTokenTriggerThreshold(model);
  let totalTokens = 0;
  if (!countTriggered) {
    for (const idx of compactableIndices) {
      const content = (messages[idx] as ToolMessage).content;
      const text = typeof content === 'string' ? content : JSON.stringify(content);
      totalTokens += Math.ceil(text.length / 3.5);
    }
  }
  const tokenTriggered = !countTriggered && totalTokens > tokenThreshold;

  if (!countTriggered && !tokenTriggered) {
    return { messages, cleared: 0, estimatedTokensSaved: 0, trigger: null };
  }

  // Keep last KEEP_RECENT, clear the rest
  const keepSet = new Set(compactableIndices.slice(-COUNT_KEEP_RECENT));
  const clearIndices = compactableIndices.filter(i => !keepSet.has(i));

  if (clearIndices.length === 0) {
    return { messages, cleared: 0, estimatedTokensSaved: 0, trigger: null };
  }

  let tokensSaved = 0;
  const clearSet = new Set(clearIndices);

  const newMessages = messages.map((msg, i) => {
    if (clearSet.has(i) && msg instanceof ToolMessage) {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      tokensSaved += Math.ceil(content.length / 3.5);
      return new ToolMessage({
        content: MC_CLEARED_MESSAGE,
        tool_call_id: msg.tool_call_id,
        name: msg.name,
      });
    }
    return msg;
  });

  return {
    messages: newMessages,
    cleared: clearIndices.length,
    estimatedTokensSaved: tokensSaved,
    trigger: countTriggered ? 'count' : 'token',
  };
}
