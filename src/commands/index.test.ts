import { describe, test, expect } from 'bun:test';
import { matchCommands, SLASH_COMMANDS } from './index.js';

describe('SLASH_COMMANDS registry', () => {
  test('every command has a non-empty name and description', () => {
    expect(SLASH_COMMANDS.length).toBeGreaterThan(5);
    for (const cmd of SLASH_COMMANDS) {
      expect(cmd.name.length).toBeGreaterThan(0);
      expect(cmd.description.length).toBeGreaterThan(0);
    }
  });

  test('contains the core scanner commands', () => {
    const names = SLASH_COMMANDS.map((c) => c.name);
    expect(names).toContain('search');
    expect(names).toContain('crypto');
    expect(names).toContain('memecoin');
    expect(names).toContain('macro');
    expect(names).toContain('ipo');
    expect(names).toContain('fear');
    expect(names).toContain('sentiment');
  });

  test('contains the system commands', () => {
    const names = SLASH_COMMANDS.map((c) => c.name);
    expect(names).toContain('model');
    expect(names).toContain('clear');
    expect(names).toContain('help');
  });

  test('command names are unique', () => {
    const names = SLASH_COMMANDS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('matchCommands', () => {
  test('a bare "/" returns ALL commands', () => {
    const matches = matchCommands('/');
    expect(matches).toHaveLength(SLASH_COMMANDS.length);
  });

  test('exact prefix matches return the command', () => {
    const matches = matchCommands('/search');
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].name).toBe('search');
  });

  test('partial prefix matches multiple commands', () => {
    const matches = matchCommands('/me'); // memecoin, memory
    const names = matches.map((c) => c.name);
    expect(names).toContain('memecoin');
    expect(names).toContain('memory');
  });

  test('case-insensitive matching', () => {
    expect(matchCommands('/SEARCH').map((c) => c.name)).toContain('search');
    expect(matchCommands('/Crypto').map((c) => c.name)).toContain('crypto');
  });

  test('no match returns an empty array', () => {
    expect(matchCommands('/zzzz')).toEqual([]);
  });

  test('matches anchored to start (prefix only)', () => {
    // 'odel' is a substring of 'model' but not a prefix
    expect(matchCommands('/odel')).toEqual([]);
  });
});
