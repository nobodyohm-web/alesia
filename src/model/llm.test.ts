import { describe, test, expect } from 'bun:test';
import { getFastModel, DEFAULT_MODEL, DEFAULT_PROVIDER } from './llm.js';

describe('getFastModel', () => {
  test('returns the provider-specific fast model when configured', () => {
    expect(getFastModel('openai', 'gpt-5.4')).toBe('gpt-4.1');
    expect(getFastModel('anthropic', 'claude-sonnet-4-6')).toBe('claude-haiku-4-5');
    expect(getFastModel('google', 'gemini-1.5-pro')).toBe('gemini-3-flash-preview');
    expect(getFastModel('xai', 'grok-4')).toBe('grok-4-1-fast-reasoning');
  });

  test('returns the fallback model when provider has no fastModel (Ollama)', () => {
    // Ollama provider has no fastModel — must fall back to the provided model
    expect(getFastModel('ollama', 'ollama:gemma2:27b')).toBe('ollama:gemma2:27b');
  });

  test('returns fallback for an unknown provider id', () => {
    expect(getFastModel('totally-unknown-provider', 'fallback-model-name')).toBe(
      'fallback-model-name',
    );
  });
});

describe('LLM module exports', () => {
  test('DEFAULT_MODEL and DEFAULT_PROVIDER are configured', () => {
    expect(typeof DEFAULT_MODEL).toBe('string');
    expect(DEFAULT_MODEL.length).toBeGreaterThan(0);
    expect(DEFAULT_PROVIDER).toBe('openai');
  });
});
