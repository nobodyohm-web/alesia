import { describe, test, expect } from 'bun:test';
import { getChannelProfile } from './channels.js';

describe('getChannelProfile', () => {
  test('returns the CLI profile when channel is omitted', () => {
    const profile = getChannelProfile();
    expect(profile.label).toBe('CLI');
    expect(profile.tables).not.toBeNull();
  });

  test('returns the CLI profile for "cli"', () => {
    expect(getChannelProfile('cli').label).toBe('CLI');
  });

  test('returns the WhatsApp profile for "whatsapp"', () => {
    const profile = getChannelProfile('whatsapp');
    expect(profile.label).toBe('WhatsApp');
    expect(profile.tables).toBeNull();
  });

  test('falls back to CLI for unknown channels', () => {
    expect(getChannelProfile('discord').label).toBe('CLI');
    expect(getChannelProfile('slack').label).toBe('CLI');
    expect(getChannelProfile('').label).toBe('CLI');
  });

  test('every profile has a non-empty label, preamble, behavior, responseFormat', () => {
    for (const channel of ['cli', 'whatsapp']) {
      const p = getChannelProfile(channel);
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.preamble.length).toBeGreaterThan(0);
      expect(p.behavior.length).toBeGreaterThan(0);
      expect(p.responseFormat.length).toBeGreaterThan(0);
    }
  });

  test('CLI profile mentions command line', () => {
    expect(getChannelProfile('cli').preamble.toLowerCase()).toContain('command line');
  });

  test('WhatsApp profile mentions WhatsApp', () => {
    expect(getChannelProfile('whatsapp').preamble.toLowerCase()).toContain('whatsapp');
  });
});
