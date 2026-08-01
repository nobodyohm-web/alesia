/**
 * Trade journal — the feedback loop that turns opinions into a track record.
 *
 * An agent that issues entry prices and never checks whether they worked is a
 * confident random generator. This closes the loop: every call is written down
 * with the reasoning that produced it, every outcome is recorded against it,
 * and `review` computes what actually happened — win rate, expectancy in R,
 * and which setups and horizons earn their keep.
 *
 * The point is not bookkeeping. It is calibration: after fifty entries the
 * journal can say "reversal setups on the day horizon lose money for you", and
 * that is worth more than any indicator.
 *
 * Stored as JSONL under .alesia/ so it survives sessions and stays diffable.
 * Append-only by construction — closing an entry rewrites its record rather
 * than deleting anything, so history cannot be quietly revised.
 */
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { formatToolResult } from '../types.js';
import { alesiaPath } from '../../utils/paths.js';
import { round } from './indicators.js';

const JOURNAL_PATH = alesiaPath('trade-journal.jsonl');

export interface JournalEntry {
  id: string;
  openedAt: string;
  symbol: string;
  direction: 'long' | 'short';
  horizon: 'day' | 'swing' | 'medium' | 'long';
  strategy?: string;
  entry: number;
  stop: number;
  target?: number;
  size?: number;
  thesis: string;
  confidence?: number;
  status: 'open' | 'closed';
  closedAt?: string;
  exit?: number;
  /** Realised result in R multiples — the only comparable unit across trades. */
  resultR?: number;
  resultPercent?: number;
  outcome?: 'win' | 'loss' | 'breakeven';
  lesson?: string;
}

async function readJournal(): Promise<JournalEntry[]> {
  try {
    const raw = await readFile(JOURNAL_PATH, 'utf-8');
    return raw
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => {
        try {
          return JSON.parse(l) as JournalEntry;
        } catch {
          // A single corrupt line must not lose the whole history.
          return null;
        }
      })
      .filter((e): e is JournalEntry => e !== null);
  } catch {
    return [];
  }
}

async function writeJournal(entries: JournalEntry[]): Promise<void> {
  await mkdir(dirname(JOURNAL_PATH), { recursive: true });
  await writeFile(JOURNAL_PATH, entries.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf-8');
}

const TradeJournalSchema = z.object({
  action: z
    .enum(['log', 'close', 'list', 'review'])
    .describe(
      "'log' records a new idea or position, 'close' records its outcome, 'list' shows open positions, 'review' computes the track record.",
    ),
  id: z.string().optional().describe("Entry id, required for 'close'. Get it from 'list'."),
  symbol: z.string().optional().describe("Ticker or pair. Required for 'log'."),
  direction: z.enum(['long', 'short']).optional().describe("Required for 'log'."),
  horizon: z.enum(['day', 'swing', 'medium', 'long']).optional().describe("Required for 'log'."),
  strategy: z.string().optional().describe("Setup name, e.g. 'trend-pullback', 'breakout'."),
  entry: z.number().optional().describe("Entry price. Required for 'log'."),
  stop: z.number().optional().describe("Stop price. Required for 'log' — a trade without a stop is not a trade."),
  target: z.number().optional().describe('Primary target price.'),
  size: z.number().optional().describe('Position size in units.'),
  thesis: z.string().optional().describe("Why this trade, in one or two sentences. Required for 'log'."),
  confidence: z.number().min(0).max(100).optional().describe('Confidence score at entry, for later calibration.'),
  exit: z.number().optional().describe("Exit price. Required for 'close'."),
  lesson: z.string().optional().describe('What this trade taught, recorded at close.'),
  symbolFilter: z.string().optional().describe("Restrict 'list' or 'review' to one symbol."),
});

export const TRADE_JOURNAL_DESCRIPTION = `
Records trade ideas and their outcomes, then computes the resulting track record.

Actions:
- **log** — record a new idea or position: symbol, direction, horizon, entry, stop, target, thesis and
  the confidence score at the time. Always log an idea when you hand the user an actionable setup.
- **close** — record the exit. Computes the result in R multiples (the outcome divided by the risk
  taken), which is the only unit comparable across positions of different sizes.
- **list** — open positions, with their current risk.
- **review** — the track record: win rate, average win and loss in R, expectancy per trade, and a
  breakdown by horizon and by strategy. Also reports whether the confidence scores were calibrated,
  meaning whether high-confidence entries actually outperformed low-confidence ones.

Use **review** before giving a new recommendation on a horizon or strategy already traded: past
results on the same kind of setup are stronger evidence than any indicator reading.
`.trim();

/** Deterministic, sortable id — no randomness so the journal stays reproducible. */
function makeId(symbol: string, when: Date): string {
  return `${symbol.toUpperCase()}-${when.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
}

interface Stats {
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgWinR: number | null;
  avgLossR: number | null;
  expectancyR: number | null;
  totalR: number;
}

/**
 * Expectancy is the number that matters: win rate alone is meaningless, since
 * a 30%-win system with 4R winners beats a 70%-win system with 0.3R winners.
 */
function computeStats(closed: JournalEntry[]): Stats {
  const withR = closed.filter((e) => typeof e.resultR === 'number');
  const wins = withR.filter((e) => (e.resultR as number) > 0);
  const losses = withR.filter((e) => (e.resultR as number) < 0);
  const mean = (xs: JournalEntry[]): number | null =>
    xs.length ? round(xs.reduce((a, e) => a + (e.resultR as number), 0) / xs.length, 2) : null;
  const totalR = withR.reduce((a, e) => a + (e.resultR as number), 0);
  return {
    trades: withR.length,
    wins: wins.length,
    losses: losses.length,
    winRate: withR.length ? round((wins.length / withR.length) * 100, 1) : null,
    avgWinR: mean(wins),
    avgLossR: mean(losses),
    expectancyR: withR.length ? round(totalR / withR.length, 3) : null,
    totalR: round(totalR, 2),
  };
}

function groupStats(closed: JournalEntry[], key: 'horizon' | 'strategy'): Record<string, Stats> {
  const bucketOf = (e: JournalEntry): string => (e[key] as string | undefined) ?? 'unspecified';
  const out: Record<string, Stats> = {};
  for (const bucket of new Set(closed.map(bucketOf))) {
    out[bucket] = computeStats(closed.filter((e) => bucketOf(e) === bucket));
  }
  return out;
}

export const tradeJournalTool = new DynamicStructuredTool({
  name: 'trade_journal',
  description:
    'Records trade ideas and outcomes, then computes the track record: win rate, average win/loss in R, expectancy, and a breakdown by horizon and strategy plus confidence calibration. Log every actionable setup handed to the user; review before recommending a setup type already traded.',
  schema: TradeJournalSchema,
  func: async (input) => {
    try {
      const entries = await readJournal();

      if (input.action === 'log') {
        const missing = (['symbol', 'direction', 'horizon', 'entry', 'stop', 'thesis'] as const).filter(
          (f) => input[f] === undefined || input[f] === null || input[f] === '',
        );
        if (missing.length > 0) {
          return formatToolResult({
            error: `Cannot log a trade without: ${missing.join(', ')}. A trade recorded without a stop or a thesis teaches nothing later.`,
          });
        }
        const entryPrice = input.entry as number;
        const stopPrice = input.stop as number;
        if (input.direction === 'long' && stopPrice >= entryPrice) {
          return formatToolResult({ error: `A long stop (${stopPrice}) must sit below the entry (${entryPrice}).` });
        }
        if (input.direction === 'short' && stopPrice <= entryPrice) {
          return formatToolResult({ error: `A short stop (${stopPrice}) must sit above the entry (${entryPrice}).` });
        }

        const now = new Date();
        const entry: JournalEntry = {
          id: makeId(input.symbol as string, now),
          openedAt: now.toISOString(),
          symbol: (input.symbol as string).toUpperCase(),
          direction: input.direction as 'long' | 'short',
          horizon: input.horizon as JournalEntry['horizon'],
          strategy: input.strategy,
          entry: entryPrice,
          stop: stopPrice,
          target: input.target,
          size: input.size,
          thesis: input.thesis as string,
          confidence: input.confidence,
          status: 'open',
        };
        entries.push(entry);
        await writeJournal(entries);
        return formatToolResult({
          logged: entry,
          riskPerUnit: round(Math.abs(entryPrice - stopPrice), 4),
          note: `Recorded as ${entry.id}. Close it with action="close" and the exit price to score it in R.`,
        });
      }

      if (input.action === 'close') {
        if (!input.id || input.exit === undefined) {
          return formatToolResult({ error: 'Closing a trade needs both id and exit price.' });
        }
        const target = entries.find((e) => e.id === input.id);
        if (!target) {
          return formatToolResult({ error: `No journal entry with id ${input.id}. Use action="list" to see open positions.` });
        }
        if (target.status === 'closed') {
          return formatToolResult({ error: `${target.id} is already closed (exit ${target.exit}, ${target.resultR}R).` });
        }

        const risk = Math.abs(target.entry - target.stop);
        const move = target.direction === 'long' ? input.exit - target.entry : target.entry - input.exit;
        const resultR = risk > 0 ? round(move / risk, 2) : 0;
        target.status = 'closed';
        target.closedAt = new Date().toISOString();
        target.exit = input.exit;
        target.resultR = resultR;
        target.resultPercent = round((move / target.entry) * 100, 2);
        target.outcome = resultR > 0.05 ? 'win' : resultR < -0.05 ? 'loss' : 'breakeven';
        if (input.lesson) target.lesson = input.lesson;

        await writeJournal(entries);
        const closed = entries.filter((e) => e.status === 'closed');
        return formatToolResult({
          closed: target,
          runningRecord: computeStats(closed),
          note: `${target.symbol} closed for ${resultR}R (${target.resultPercent}%).`,
        });
      }

      const scoped = input.symbolFilter
        ? entries.filter((e) => e.symbol === input.symbolFilter?.toUpperCase())
        : entries;

      if (input.action === 'list') {
        const open = scoped.filter((e) => e.status === 'open');
        return formatToolResult({
          openPositions: open.map((e) => ({
            id: e.id,
            symbol: e.symbol,
            direction: e.direction,
            horizon: e.horizon,
            entry: e.entry,
            stop: e.stop,
            target: e.target,
            riskPerUnit: round(Math.abs(e.entry - e.stop), 4),
            openedAt: e.openedAt,
            thesis: e.thesis,
          })),
          count: open.length,
          note: open.length === 0 ? 'No open positions recorded.' : undefined,
        });
      }

      // review
      const closed = scoped.filter((e) => e.status === 'closed');
      if (closed.length === 0) {
        return formatToolResult({
          note: 'No closed trades yet — there is no track record to review. Log ideas as they are given and close them as they resolve; the calibration only becomes meaningful after 20 or so.',
          openCount: scoped.filter((e) => e.status === 'open').length,
        });
      }

      const overall = computeStats(closed);
      // Calibration: did the confidence score predict anything? If high- and
      // low-confidence trades perform the same, the score is decoration.
      const scored = closed.filter((e) => typeof e.confidence === 'number' && typeof e.resultR === 'number');
      const high = scored.filter((e) => (e.confidence as number) >= 65);
      const low = scored.filter((e) => (e.confidence as number) < 65);
      const calibration =
        high.length >= 3 && low.length >= 3
          ? {
              highConfidenceExpectancyR: computeStats(high).expectancyR,
              lowConfidenceExpectancyR: computeStats(low).expectancyR,
              verdict:
                (computeStats(high).expectancyR ?? 0) > (computeStats(low).expectancyR ?? 0)
                  ? 'Confidence scores are informative — higher-scored setups did perform better.'
                  : 'Confidence scores are NOT predictive here. Treat them as descriptive, not as a sizing input.',
            }
          : { note: `Need at least 3 closed trades either side of the 65 threshold to judge calibration (have ${high.length} high, ${low.length} low).` };

      return formatToolResult({
        overall,
        byHorizon: groupStats(closed, 'horizon'),
        byStrategy: groupStats(closed, 'strategy'),
        calibration,
        sampleWarning:
          overall.trades < 20
            ? `Only ${overall.trades} closed trades. That is far too small a sample to draw conclusions from — treat these numbers as a record, not as evidence.`
            : undefined,
        interpretation:
          overall.expectancyR !== null && overall.expectancyR > 0
            ? `Positive expectancy: ${overall.expectancyR}R per trade over ${overall.trades} trades.`
            : `Negative expectancy: ${overall.expectancyR}R per trade. The process is losing money over this sample.`,
      });
    } catch (error) {
      return formatToolResult({
        error: `Trade journal failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  },
});
