import { describe, test, expect, beforeEach } from 'bun:test';
import {
  discoverSkills,
  getSkill,
  buildSkillMetadataSection,
  clearSkillCache,
} from './registry.js';

beforeEach(() => {
  clearSkillCache();
});

describe('discoverSkills', () => {
  test('finds the bundled SKILL.md files', () => {
    const skills = discoverSkills();
    expect(skills.length).toBeGreaterThan(10);
    const names = skills.map((s) => s.name);
    // Core skills that should always be present in the project
    expect(names).toContain('master-analysis');
    expect(names).toContain('opportunity-scanner');
    expect(names).toContain('crypto-scanner');
    expect(names).toContain('memecoin-scanner');
    expect(names).toContain('macro-radar');
    expect(names).toContain('news-sentiment');
  });

  test('returns metadata with name, description, source, and path', () => {
    const skills = discoverSkills();
    for (const skill of skills) {
      expect(typeof skill.name).toBe('string');
      expect(typeof skill.description).toBe('string');
      expect(skill.description.length).toBeGreaterThan(0);
      expect(typeof skill.path).toBe('string');
      expect(skill.path.endsWith('SKILL.md')).toBe(true);
    }
  });

  test('skill names are unique (no duplicates between sources)', () => {
    const skills = discoverSkills();
    const names = skills.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test('uses cache on subsequent calls (returns same array reference contents)', () => {
    const a = discoverSkills();
    const b = discoverSkills();
    expect(a.length).toBe(b.length);
    expect(a.map((s) => s.name).sort()).toEqual(b.map((s) => s.name).sort());
  });

  test('clearSkillCache forces re-discovery', () => {
    const a = discoverSkills();
    clearSkillCache();
    const b = discoverSkills();
    expect(b.length).toBe(a.length);
  });
});

describe('getSkill', () => {
  test('returns full skill including instructions for known names', () => {
    const skill = getSkill('master-analysis');
    expect(skill).toBeDefined();
    expect(skill?.name).toBe('master-analysis');
    expect(skill?.instructions.length).toBeGreaterThan(100);
    expect(skill?.instructions).toContain('PHASE');
  });

  test('returns undefined for unknown skill name', () => {
    expect(getSkill('does-not-exist')).toBeUndefined();
  });

  test('returns crypto-scanner with the autonomous-execution preamble', () => {
    const skill = getSkill('crypto-scanner');
    expect(skill?.instructions).toContain('INSTRUCTIONS STRICTES');
  });

  test('returns news-sentiment skill with sentiment scoring formula', () => {
    const skill = getSkill('news-sentiment');
    expect(skill).toBeDefined();
    expect(skill?.instructions).toContain('bullish');
    expect(skill?.instructions).toContain('bearish');
    expect(skill?.instructions).toContain('SCORE SENTIMENT');
  });
});

describe('buildSkillMetadataSection', () => {
  test('returns a bullet line per skill', () => {
    const section = buildSkillMetadataSection();
    const skills = discoverSkills();
    const lines = section.split('\n').filter((line) => line.trim().length > 0);
    expect(lines.length).toBe(skills.length);
    for (const line of lines) {
      expect(line.startsWith('- **')).toBe(true);
    }
  });

  test('mentions the master-analysis skill', () => {
    const section = buildSkillMetadataSection();
    expect(section).toContain('master-analysis');
  });
});
