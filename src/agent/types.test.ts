import { describe, test, expect } from 'bun:test';
import type {
  AgentEvent,
  CompactionEvent,
  DoneEvent,
  ToolStartEvent,
  ToolEndEvent,
  ToolErrorEvent,
  StreamProgressEvent,
} from './types.js';

// These tests pin down the discriminated-union shape so refactors can't
// silently break event emission for the CLI / runner.

describe('AgentEvent discriminated union', () => {
  test('ToolStartEvent has tool, args, optional toolCallId', () => {
    const event: ToolStartEvent = {
      type: 'tool_start',
      tool: 'yahoo_summary',
      args: { ticker: 'AAPL' },
      toolCallId: 'tc_1',
    };
    expect(event.type).toBe('tool_start');
    expect(event.tool).toBe('yahoo_summary');
  });

  test('ToolEndEvent carries result and duration', () => {
    const event: ToolEndEvent = {
      type: 'tool_end',
      tool: 'yahoo_summary',
      args: { ticker: 'AAPL' },
      result: '{"data":{}}',
      duration: 230,
      toolCallId: 'tc_1',
    };
    expect(event.duration).toBe(230);
    expect(event.result.length).toBeGreaterThan(0);
  });

  test('ToolErrorEvent carries an error string', () => {
    const event: ToolErrorEvent = {
      type: 'tool_error',
      tool: 'yahoo_summary',
      error: 'Network timeout',
    };
    expect(event.error).toBe('Network timeout');
  });

  test('CompactionEvent supports optional errorMessage on failure', () => {
    const success: CompactionEvent = {
      type: 'compaction',
      phase: 'end',
      success: true,
      preCompactTokens: 90_000,
      postCompactTokens: 12_000,
    };
    const failure: CompactionEvent = {
      type: 'compaction',
      phase: 'end',
      success: false,
      preCompactTokens: 90_000,
      errorMessage: 'Compaction returned empty response',
    };
    expect(success.success).toBe(true);
    expect(failure.errorMessage).toContain('empty response');
  });

  test('DoneEvent shape is complete', () => {
    const event: DoneEvent = {
      type: 'done',
      answer: 'Final answer',
      toolCalls: [],
      iterations: 5,
      totalTime: 1234,
    };
    expect(event.iterations).toBe(5);
    expect(event.toolCalls).toEqual([]);
  });

  test('StreamProgressEvent enumerates valid modes', () => {
    const modes: StreamProgressEvent['mode'][] = [
      'requesting',
      'thinking',
      'responding',
      'tool-input',
      'tool-use',
    ];
    for (const mode of modes) {
      const e: StreamProgressEvent = { type: 'stream_progress', charDelta: 10, mode };
      expect(e.mode).toBe(mode);
    }
  });

  test('AgentEvent union assignable to all discriminants', () => {
    const events: AgentEvent[] = [
      { type: 'thinking', message: 'analyzing' },
      { type: 'tool_start', tool: 'x', args: {} },
      { type: 'tool_progress', tool: 'x', message: 'fetching' },
      { type: 'context_cleared', clearedCount: 3, keptCount: 5 },
      { type: 'queue_drain', messageCount: 1, mergedText: 'hi' },
    ];
    expect(events.length).toBe(5);
  });
});
