import { describe, test, expect } from 'bun:test';
import {
  buildSystemPrompt,
  buildGroupSection,
  getCurrentDate,
  DEFAULT_SYSTEM_PROMPT,
} from './prompts.js';

describe('getCurrentDate', () => {
  test('returns a non-empty formatted string', () => {
    const date = getCurrentDate();
    expect(date.length).toBeGreaterThan(0);
    expect(date).toContain(','); // long format includes a comma after the weekday
  });

  test('contains the current year', () => {
    const date = getCurrentDate();
    const year = new Date().getFullYear().toString();
    expect(date).toContain(year);
  });
});

describe('DEFAULT_SYSTEM_PROMPT', () => {
  test('includes the agent name and the current date', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain('Alesia');
    expect(DEFAULT_SYSTEM_PROMPT).toContain('Current date');
  });
});

describe('buildSystemPrompt', () => {
  test('returns a prompt that contains the model-specific tool list', () => {
    const prompt = buildSystemPrompt('claude-sonnet-4-6');
    expect(prompt).toContain('Available Tools');
    expect(prompt).toContain('Smart Routing');
    expect(prompt).toContain('Tool Usage Policy');
  });

  test('injects SOUL.md content when provided', () => {
    const prompt = buildSystemPrompt('gpt-5.4', '## My Identity\nI am a value investor.');
    expect(prompt).toContain('## My Identity');
    expect(prompt).toContain('value investor');
  });

  test('injects user research rules when provided', () => {
    const prompt = buildSystemPrompt('gpt-5.4', null, 'cli', undefined, [], null, 'Always check FCF first.');
    expect(prompt).toContain('Research Rules');
    expect(prompt).toContain('Always check FCF first.');
  });

  test('omits the rules section when no rules provided', () => {
    const prompt = buildSystemPrompt('gpt-5.4', null, 'cli');
    expect(prompt).not.toContain('## Research Rules');
  });

  test('uses the WhatsApp profile when channel="whatsapp"', () => {
    const prompt = buildSystemPrompt('gpt-5.4', null, 'whatsapp');
    expect(prompt.toLowerCase()).toContain('whatsapp');
  });

  test('falls back to CLI profile when channel is unknown', () => {
    const prompt = buildSystemPrompt('gpt-5.4', null, 'unknown-channel');
    expect(prompt).toContain('command line interface');
  });
});

describe('buildGroupSection', () => {
  test('includes the group name when provided', () => {
    const section = buildGroupSection({ groupName: 'Investing Club', activationMode: 'mention' });
    expect(section).toContain('Investing Club');
    expect(section).toContain('Group');
  });

  test('falls back to a generic label when groupName is omitted', () => {
    const section = buildGroupSection({ activationMode: 'mention' });
    expect(section).toContain('WhatsApp group');
  });

  test('lists members when membersList is provided', () => {
    const section = buildGroupSection({
      groupName: 'Test',
      membersList: 'Alice, Bob',
      activationMode: 'mention',
    });
    expect(section).toContain('Alice, Bob');
    expect(section).toContain('Group members');
  });

  test('always tells the agent it was @-mentioned', () => {
    const section = buildGroupSection({ activationMode: 'mention' });
    expect(section).toContain('@-mentioned');
  });
});

describe('buildSystemPrompt — smart routing patterns', () => {
  test('includes routing for opportunity-scanner triggers', () => {
    const prompt = buildSystemPrompt('claude-sonnet-4-6');
    expect(prompt).toContain('opportunity-scanner');
    expect(prompt).toContain('crypto-scanner');
    expect(prompt).toContain('memecoin-scanner');
  });

  test('mentions news-sentiment routing pattern', () => {
    const prompt = buildSystemPrompt('claude-sonnet-4-6');
    expect(prompt).toContain('news-sentiment');
  });

  test('mentions master-analysis bare-ticker routing', () => {
    const prompt = buildSystemPrompt('claude-sonnet-4-6');
    expect(prompt).toContain('master-analysis');
    expect(prompt).toContain('Bare ticker');
  });
});

describe('buildSystemPrompt — memory section', () => {
  test('lists memory files when provided', () => {
    const prompt = buildSystemPrompt('gpt-5.4', null, 'cli', undefined, ['user.md', 'goals.md']);
    expect(prompt).toContain('user.md');
    expect(prompt).toContain('goals.md');
  });

  test('embeds memory context when provided', () => {
    const prompt = buildSystemPrompt(
      'gpt-5.4',
      null,
      'cli',
      undefined,
      [],
      'User trades on Trade Republic, EU.',
    );
    expect(prompt).toContain('Trade Republic');
  });
});
