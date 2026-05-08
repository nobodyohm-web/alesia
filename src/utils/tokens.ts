/**
 * Token estimation utilities for context management.
 * Uses actual API token counts when available,
 * falling back to character-based estimation.
 */

import { resolveProvider } from '../providers.js';

// ---------------------------------------------------------------------------
// Character-based estimation (fallback)
// ---------------------------------------------------------------------------

/**
 * Rough token estimation based on character count.
 * JSON is denser than prose, so we use ~3.5 chars per token.
 * This is conservative - better to underestimate available space.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

// ---------------------------------------------------------------------------
// Model-aware threshold
// ---------------------------------------------------------------------------

/**
 * Maximum tokens reserved for the LLM's output during compaction. Caps the
 * proportional reservation below — we never reserve more than 20K even on
 * 1M-token windows.
 */
const MAX_OUTPUT_TOKENS_FOR_SUMMARY = 20_000;

/**
 * Minimum output reservation. For a tiny context window we still need at
 * least this much headroom to fit a structured master-analysis report.
 */
const MIN_OUTPUT_TOKENS = 4_000;

/**
 * Maximum buffer between the auto-compact threshold and the effective ctx
 * window. Caps the proportional buffer below.
 */
const MAX_AUTOCOMPACT_BUFFER = 13_000;

/** Minimum buffer floor — must always have at least this much margin. */
const MIN_AUTOCOMPACT_BUFFER = 2_000;

/** Fallback context window when provider doesn't specify one. */
const DEFAULT_CONTEXT_WINDOW = 128_000;

/**
 * Resolve the raw declared context window for a model.
 * Centralized so callers don't have to deal with `undefined` from the registry.
 */
function getRawContextWindow(model: string): number {
  return resolveProvider(model).contextWindow ?? DEFAULT_CONTEXT_WINDOW;
}

/**
 * Get the effective context window size for a model, accounting for reserved output tokens.
 *
 * Reservation scales with the window: 15% of the window, clamped to
 * `[MIN_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS_FOR_SUMMARY]`. This keeps the
 * Anthropic-class behavior unchanged (reserves 20K for 200K windows) and
 * still leaves a sane reserve on small windows like Ollama 32K.
 */
export function getEffectiveContextWindow(model: string): number {
  const ctxWindow = getRawContextWindow(model);
  const outputReserve = Math.min(
    MAX_OUTPUT_TOKENS_FOR_SUMMARY,
    Math.max(MIN_OUTPUT_TOKENS, Math.floor(ctxWindow * 0.15)),
  );
  return Math.max(0, ctxWindow - outputReserve);
}

/**
 * Get the auto-compact threshold for a model — the input-token count at which
 * compaction should trigger.
 *
 * Formula: `effectiveCtx − buffer`, where buffer is 10% of the raw window
 * clamped to `[MIN_AUTOCOMPACT_BUFFER, MAX_AUTOCOMPACT_BUFFER]`. For 200K+
 * windows this matches the original 13K constant; for 32K Ollama it shrinks
 * to ~3.2K so the threshold lands at a usable ~24K instead of negative.
 */
export function getAutoCompactThreshold(model: string): number {
  const ctxWindow = getRawContextWindow(model);
  const buffer = Math.min(
    MAX_AUTOCOMPACT_BUFFER,
    Math.max(MIN_AUTOCOMPACT_BUFFER, Math.floor(ctxWindow * 0.10)),
  );
  return Math.max(0, getEffectiveContextWindow(model) - buffer);
}

// ---------------------------------------------------------------------------
// Legacy constants
// ---------------------------------------------------------------------------

/**
 * Static threshold used as fallback by memory flush.
 */
export const CONTEXT_THRESHOLD = 100_000;

/**
 * Number of most recent tool results to keep when clearing.
 */
export const KEEP_TOOL_USES = 5;
