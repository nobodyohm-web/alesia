import { describe, test, expect } from 'bun:test';
import { ToolMessage, SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import {
  microcompactMessages,
  getTokenTriggerThreshold,
  MC_CLEARED_MESSAGE,
  COUNT_TRIGGER_THRESHOLD,
  COUNT_KEEP_RECENT,
  DEFAULT_TOKEN_TRIGGER_THRESHOLD,
} from './microcompact.js';

function makeToolMsg(name: string, content: string, idx: number): ToolMessage {
  return new ToolMessage({ content, tool_call_id: `tc-${idx}`, name });
}

describe('getTokenTriggerThreshold', () => {
  test('returns the default when no model is provided', () => {
    expect(getTokenTriggerThreshold()).toBe(DEFAULT_TOKEN_TRIGGER_THRESHOLD);
  });

  test('scales down for Ollama 65K (75% of effective ctx)', () => {
    const t = getTokenTriggerThreshold('ollama:gemma2:27b');
    // Should be roughly 75% of effective ctx (~55.7K), so ~41K
    expect(t).toBeLessThan(50_000);
    expect(t).toBeGreaterThanOrEqual(15_000);
  });

  test('scales up for Anthropic 200K (75% of 180K effective = 135K)', () => {
    const t = getTokenTriggerThreshold('claude-sonnet-4-6');
    expect(t).toBe(Math.floor(180_000 * 0.75));
  });
});

describe('microcompactMessages — count trigger', () => {
  test('does not fire when under the count threshold', () => {
    const msgs = [
      new SystemMessage('sys'),
      new HumanMessage('q'),
      ...Array.from({ length: COUNT_TRIGGER_THRESHOLD }, (_, i) =>
        makeToolMsg('yahoo_summary', `result ${i}`, i),
      ),
    ];
    const out = microcompactMessages(msgs);
    expect(out.trigger).toBe(null);
    expect(out.cleared).toBe(0);
  });

  test('fires when count exceeds threshold and keeps the most recent N', () => {
    const total = COUNT_TRIGGER_THRESHOLD + 3;
    const msgs = [
      new SystemMessage('sys'),
      new HumanMessage('q'),
      ...Array.from({ length: total }, (_, i) =>
        makeToolMsg('yahoo_summary', `result-${i}-${'x'.repeat(50)}`, i),
      ),
    ];
    const out = microcompactMessages(msgs);
    expect(out.trigger).toBe('count');
    expect(out.cleared).toBe(total - COUNT_KEEP_RECENT);

    // Last COUNT_KEEP_RECENT messages should be untouched
    const tools = out.messages.filter((m) => m instanceof ToolMessage) as ToolMessage[];
    const recent = tools.slice(-COUNT_KEEP_RECENT);
    for (const m of recent) {
      expect(m.content).not.toBe(MC_CLEARED_MESSAGE);
    }
    // Older messages should have the marker
    const older = tools.slice(0, tools.length - COUNT_KEEP_RECENT);
    for (const m of older) {
      expect(m.content).toBe(MC_CLEARED_MESSAGE);
    }
  });
});

describe('microcompactMessages — covers free-tier tools', () => {
  // The previous implementation only listed paid meta-tools. These names should
  // all be compactable now — pre-fix, this test would fail.
  const FREE_TOOLS = [
    'yahoo_summary',
    'yahoo_historical',
    'yahoo_quote',
    'yahoo_financials',
    'yahoo_key_stats',
    'binance_price',
    'binance_klines',
    'binance_top_movers',
    'rss_intelligence',
    'analyst_consensus',
    'insider_detector',
    'ipo_tracker',
    'fear_greed_index',
  ];

  test.each(FREE_TOOLS)('clears %s results when count threshold exceeded', (toolName) => {
    const total = COUNT_TRIGGER_THRESHOLD + 2;
    const msgs = [
      new SystemMessage('sys'),
      new HumanMessage('q'),
      new AIMessage('thinking'),
      ...Array.from({ length: total }, (_, i) =>
        makeToolMsg(toolName, `${toolName} result ${i} ${'pad'.repeat(20)}`, i),
      ),
    ];
    const out = microcompactMessages(msgs);
    expect(out.trigger).toBe('count');
    expect(out.cleared).toBeGreaterThan(0);
  });
});

describe('microcompactMessages — non-compactable tools', () => {
  test('does not clear `skill` results even when over count threshold', () => {
    const msgs = [
      new SystemMessage('sys'),
      new HumanMessage('q'),
      ...Array.from({ length: COUNT_TRIGGER_THRESHOLD + 5 }, (_, i) =>
        makeToolMsg('skill', `skill ${i}`, i),
      ),
    ];
    const out = microcompactMessages(msgs);
    expect(out.trigger).toBe(null);
    expect(out.cleared).toBe(0);
  });

  test('does not clear `write_file` or `edit_file` results', () => {
    const msgs = [
      new SystemMessage('sys'),
      new HumanMessage('q'),
      ...Array.from({ length: COUNT_TRIGGER_THRESHOLD + 5 }, (_, i) =>
        makeToolMsg(i % 2 === 0 ? 'write_file' : 'edit_file', `wrote ${i}`, i),
      ),
    ];
    const out = microcompactMessages(msgs);
    expect(out.trigger).toBe(null);
  });
});

describe('microcompactMessages — token trigger (model-aware)', () => {
  test('fires for Ollama at lower threshold than Anthropic', () => {
    // 6 messages (above KEEP_RECENT=4 floor) of 40K chars (~11.4K tokens) each.
    // Total ~68K tokens, count below trigger (8). Anthropic threshold (~135K) won't
    // fire; Ollama threshold (~21K) should.
    const big = 'X'.repeat(40_000);
    const msgs = [
      new SystemMessage('sys'),
      new HumanMessage('q'),
      ...Array.from({ length: 6 }, (_, i) => makeToolMsg('yahoo_summary', big, i)),
    ];

    const anthropic = microcompactMessages([...msgs], 'claude-sonnet-4-6');
    expect(anthropic.trigger).toBe(null);

    const ollama = microcompactMessages([...msgs], 'ollama:gemma2:27b');
    expect(ollama.trigger).toBe('token');
    expect(ollama.cleared).toBe(2); // 6 - KEEP_RECENT(4) = 2 cleared
  });
});

describe('microcompactMessages — preserves tool_call_id and name', () => {
  test('cleared messages keep their tool_call_id and name for ToolMessage pairing', () => {
    const total = COUNT_TRIGGER_THRESHOLD + 2;
    const msgs = [
      new SystemMessage('sys'),
      new HumanMessage('q'),
      ...Array.from({ length: total }, (_, i) =>
        makeToolMsg('yahoo_summary', `r${i}${'p'.repeat(30)}`, i),
      ),
    ];
    const out = microcompactMessages(msgs);
    const tools = out.messages.filter((m) => m instanceof ToolMessage) as ToolMessage[];
    for (const [i, t] of tools.entries()) {
      expect(t.tool_call_id).toBe(`tc-${i}`);
      expect(t.name).toBe('yahoo_summary');
    }
  });
});
