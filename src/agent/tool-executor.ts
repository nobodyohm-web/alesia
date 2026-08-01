import { AIMessage } from '@langchain/core/messages';
import type { ToolCall } from '@langchain/core/messages/tool';
import { StructuredToolInterface } from '@langchain/core/tools';
import { createProgressChannel } from '../utils/progress-channel.js';
import { all } from '../utils/concurrency.js';
import type {
  ApprovalDecision,
  ToolApprovalEvent,
  ToolDeniedEvent,
  ToolEndEvent,
  ToolErrorEvent,
  ToolLimitEvent,
  ToolProgressEvent,
  ToolStartEvent,
} from './types.js';
import type { RunContext } from './run-context.js';

type ToolExecutionEvent =
  | ToolStartEvent
  | ToolProgressEvent
  | ToolEndEvent
  | ToolErrorEvent
  | ToolApprovalEvent
  | ToolDeniedEvent
  | ToolLimitEvent;

const TOOLS_REQUIRING_APPROVAL = ['write_file', 'edit_file'] as const;
const DEFAULT_MAX_CONCURRENCY = 10;
const TOOL_TIMEOUT_MS = 30_000;

/**
 * Per-tool timeout overrides. `stock_screener` does an internal LLM call
 * (`callLlm`) on the same Ollama GPU as the main agent. Ollama serializes
 * requests, so the screener must wait for the main inference to finish
 * before its own starts → 30s is never enough. 120s gives headroom.
 */
const TOOL_TIMEOUT_OVERRIDES: Record<string, number> = {
  stock_screener: 120_000,
};

interface ToolCallBatch {
  concurrent: boolean;
  calls: ToolCall[];
}

/**
 * Executes tool calls with concurrent support for read-only tools.
 *
 * Consecutive concurrent-safe tool calls are batched and run in parallel
 * (up to maxConcurrency). Non-concurrent tools execute serially with
 * approval gates where required.
 */
export class AgentToolExecutor {
  private readonly sessionApprovedTools: Set<string>;
  private readonly maxConcurrency: number;

  constructor(
    private readonly toolMap: Map<string, StructuredToolInterface>,
    private readonly concurrencyMap: Map<string, boolean>,
    private readonly signal?: AbortSignal,
    private readonly requestToolApproval?: (request: {
      tool: string;
      args: Record<string, unknown>;
    }) => Promise<ApprovalDecision>,
    sessionApprovedTools?: Set<string>,
    maxConcurrency?: number,
  ) {
    this.sessionApprovedTools = sessionApprovedTools ?? new Set();
    this.maxConcurrency = maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
  }

  /**
   * Whether a human can actually be asked to approve a sensitive tool.
   *
   * False on headless channels (WhatsApp gateway, cron), where approval
   * requests are auto-denied. Callers use this to tell a deliberate user
   * refusal apart from "nobody was there to ask".
   */
  get canPromptForApproval(): boolean {
    return this.requestToolApproval !== undefined;
  }

  /**
   * Execute all tool calls from an AIMessage response.
   * Concurrent-safe tools run in parallel batches; others run serially.
   */
  async *executeAll(
    response: AIMessage,
    ctx: RunContext,
  ): AsyncGenerator<ToolExecutionEvent, void> {
    const batches = this.partitionToolCalls(response.tool_calls!, ctx);

    for (const batch of batches) {
      if (batch.concurrent && batch.calls.length > 1) {
        yield* this.executeBatchConcurrently(batch.calls, ctx);
      } else {
        for (const call of batch.calls) {
          yield* this.executeSingleWithId(call, ctx);
        }
      }
    }
  }

  /**
   * Partition tool_calls into batches of consecutive concurrent-safe calls
   * vs individual non-concurrent calls.
   */
  private partitionToolCalls(toolCalls: ToolCall[], ctx: RunContext): ToolCallBatch[] {
    const batches: ToolCallBatch[] = [];

    for (const call of toolCalls) {
      // Skill dedup — skip already-executed skills
      if (call.name === 'skill') {
        const skillName = (call.args as Record<string, unknown>).skill as string;
        if (ctx.scratchpad.hasExecutedSkill(skillName)) continue;
      }

      const isSafe = this.concurrencyMap.get(call.name) ?? false;
      const lastBatch = batches[batches.length - 1];

      if (isSafe && lastBatch?.concurrent) {
        lastBatch.calls.push(call);
      } else {
        batches.push({ concurrent: isSafe, calls: [call] });
      }
    }

    return batches;
  }

  /**
   * Execute a batch of concurrent-safe tools in parallel.
   */
  private async *executeBatchConcurrently(
    calls: ToolCall[],
    ctx: RunContext,
  ): AsyncGenerator<ToolExecutionEvent, void> {
    const generators = calls.map(call => this.executeSingleWithId(call, ctx));
    yield* all(generators, this.maxConcurrency);
  }

  /**
   * Execute a single tool call, emitting toolCallId on every event.
   */
  private async *executeSingleWithId(
    call: ToolCall,
    ctx: RunContext,
  ): AsyncGenerator<ToolExecutionEvent, void> {
    const toolName = call.name;
    const toolArgs = call.args as Record<string, unknown>;
    const toolCallId = call.id;
    const toolQuery = this.extractQueryFromArgs(toolArgs);

    // Approval flow for sensitive tools
    if (this.requiresApproval(toolName) && !this.sessionApprovedTools.has(toolName)) {
      const decision = (await this.requestToolApproval?.({ tool: toolName, args: toolArgs })) ?? 'deny';
      yield { type: 'tool_approval', tool: toolName, args: toolArgs, approved: decision };
      if (decision === 'deny') {
        yield { type: 'tool_denied', tool: toolName, args: toolArgs, toolCallId };
        return;
      }
      if (decision === 'allow-session') {
        for (const name of TOOLS_REQUIRING_APPROVAL) {
          this.sessionApprovedTools.add(name);
        }
      }
    }

    // Tool limit check (warn but never block)
    const limitCheck = ctx.scratchpad.canCallTool(toolName, toolQuery);
    if (limitCheck.warning) {
      yield { type: 'tool_limit', tool: toolName, warning: limitCheck.warning, blocked: false };
    }

    yield { type: 'tool_start', tool: toolName, args: toolArgs, toolCallId };

    const toolStartTime = Date.now();

    try {
      const tool = this.toolMap.get(toolName);
      if (!tool) {
        throw new Error(`Tool '${toolName}' not found`);
      }

      const channel = createProgressChannel();
      const config = {
        metadata: { onProgress: channel.emit },
        ...(this.signal ? { signal: this.signal } : {}),
      };

      // Per-tool timeout: default 30s, overridden for tools with internal LLM
      // calls (e.g. stock_screener). A stuck network call must not freeze the agent.
      const toolTimeoutMs = TOOL_TIMEOUT_OVERRIDES[toolName] ?? TOOL_TIMEOUT_MS;
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          channel.close();
          reject(new Error(`Tool '${toolName}' timed out after ${toolTimeoutMs / 1000}s`));
        }, toolTimeoutMs);
      });

      const toolPromise = Promise.race([
        tool.invoke(toolArgs, config).then(
          (raw) => { channel.close(); return raw; },
          (err) => { channel.close(); throw err; },
        ),
        timeoutPromise,
      ]).finally(() => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      });

      for await (const message of channel) {
        yield { type: 'tool_progress', tool: toolName, message } as ToolProgressEvent;
      }

      const rawResult = await toolPromise;
      const result = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult);
      const duration = Date.now() - toolStartTime;

      yield { type: 'tool_end', tool: toolName, args: toolArgs, result, duration, toolCallId };

      ctx.scratchpad.recordToolCall(toolName, toolQuery);
      ctx.scratchpad.addToolResult(toolName, toolArgs, result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      yield { type: 'tool_error', tool: toolName, error: errorMessage, toolCallId };

      ctx.scratchpad.recordToolCall(toolName, toolQuery);
      ctx.scratchpad.addToolResult(toolName, toolArgs, `Error: ${errorMessage}`);
    }
  }

  private extractQueryFromArgs(args: Record<string, unknown>): string | undefined {
    const queryKeys = ['query', 'search', 'question', 'q', 'text', 'input'];
    for (const key of queryKeys) {
      if (typeof args[key] === 'string') {
        return args[key] as string;
      }
    }
    return undefined;
  }

  private requiresApproval(toolName: string): boolean {
    return (TOOLS_REQUIRING_APPROVAL as readonly string[]).includes(toolName);
  }
}
