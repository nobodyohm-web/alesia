import { describe, test, expect } from 'bun:test';
import { existsSync } from 'node:fs';
import { Scratchpad } from './scratchpad.js';
import { alesiaPath } from '../utils/paths.js';

const scratchpadDir = alesiaPath('scratchpad');

describe('Scratchpad — hasExecutedSkill in-memory cache', () => {
  test('returns false before any tool call', () => {
    const sp = new Scratchpad('q-empty');
    expect(sp.hasExecutedSkill('master-analysis')).toBe(false);
  });

  test('returns true immediately after addToolResult records a skill call', () => {
    const sp = new Scratchpad('q-skill');
    sp.addToolResult('skill', { skill: 'master-analysis', args: 'AAPL' }, '{"ok":true}');
    expect(sp.hasExecutedSkill('master-analysis')).toBe(true);
    expect(sp.hasExecutedSkill('crypto-analysis')).toBe(false);
  });

  test('non-skill tool calls do not pollute the cache', () => {
    const sp = new Scratchpad('q-other');
    sp.addToolResult('yahoo_summary', { ticker: 'AAPL' }, '{"data":{}}');
    sp.addToolResult('rss_intelligence', { query: 'AAPL' }, '{"data":{}}');
    expect(sp.hasExecutedSkill('master-analysis')).toBe(false);
  });

  test('records multiple distinct skills', () => {
    const sp = new Scratchpad('q-multi');
    sp.addToolResult('skill', { skill: 'master-analysis' }, '{}');
    sp.addToolResult('skill', { skill: 'dcf-valuation' }, '{}');
    expect(sp.hasExecutedSkill('master-analysis')).toBe(true);
    expect(sp.hasExecutedSkill('dcf-valuation')).toBe(true);
    expect(sp.hasExecutedSkill('crypto-analysis')).toBe(false);
  });

  test('handles missing or non-string skill arg gracefully', () => {
    const sp = new Scratchpad('q-bogus');
    // No skill name in args — should not throw, should not add anything
    sp.addToolResult('skill', {}, '{}');
    sp.addToolResult('skill', { skill: 42 as unknown as string }, '{}');
    expect(sp.hasExecutedSkill('master-analysis')).toBe(false);
  });
});

describe('Scratchpad — scratchpad directory is created on construction', () => {
  test('directory exists after construction', () => {
    new Scratchpad('q-mkdir');
    expect(existsSync(scratchpadDir)).toBe(true);
  });
});

describe('Scratchpad — getToolCallRecords reflects appended results', () => {
  test('returns the recorded tool calls in order', () => {
    const sp = new Scratchpad('q-records');
    sp.addToolResult('yahoo_summary', { ticker: 'AAPL' }, '{"data":{"price":150}}');
    sp.addToolResult('rss_intelligence', { query: 'AAPL' }, '{"data":{"items":[]}}');
    const records = sp.getToolCallRecords();
    expect(records).toHaveLength(2);
    expect(records[0].tool).toBe('yahoo_summary');
    expect(records[1].tool).toBe('rss_intelligence');
  });
});
