import { describe, test, expect } from 'bun:test';
import {
  PROVIDERS,
  OLLAMA_NUM_CTX,
  resolveProvider,
  getProviderById,
} from './providers.js';

describe('PROVIDERS registry', () => {
  test('contains all expected providers', () => {
    const ids = PROVIDERS.map((p) => p.id).sort();
    expect(ids).toEqual([
      'anthropic',
      'deepseek',
      'google',
      'moonshot',
      'ollama',
      'openai',
      'openrouter',
      'xai',
    ]);
  });

  test('every provider has a positive context window', () => {
    for (const p of PROVIDERS) {
      expect(p.contextWindow).toBeGreaterThan(0);
    }
  });

  test('Ollama context window matches OLLAMA_NUM_CTX (single source of truth)', () => {
    const ollama = PROVIDERS.find((p) => p.id === 'ollama');
    expect(ollama?.contextWindow).toBe(OLLAMA_NUM_CTX);
  });

  test('non-Ollama providers declare an apiKeyEnvVar', () => {
    for (const p of PROVIDERS) {
      if (p.id === 'ollama') continue;
      expect(p.apiKeyEnvVar).toBeDefined();
      expect(p.apiKeyEnvVar?.length).toBeGreaterThan(0);
    }
  });
});

describe('resolveProvider', () => {
  test('routes claude-* to Anthropic', () => {
    expect(resolveProvider('claude-sonnet-4-6').id).toBe('anthropic');
    expect(resolveProvider('claude-haiku-4-5').id).toBe('anthropic');
  });

  test('routes gemini-* to Google', () => {
    expect(resolveProvider('gemini-3-flash-preview').id).toBe('google');
  });

  test('routes grok-* to xAI', () => {
    expect(resolveProvider('grok-4').id).toBe('xai');
  });

  test('routes deepseek-* to DeepSeek', () => {
    expect(resolveProvider('deepseek-v4-flash').id).toBe('deepseek');
  });

  test('routes openrouter:* to OpenRouter', () => {
    expect(resolveProvider('openrouter:openai/gpt-4o-mini').id).toBe('openrouter');
  });

  test('routes ollama:* to Ollama', () => {
    expect(resolveProvider('ollama:gemma2:27b').id).toBe('ollama');
  });

  test('routes kimi-* to Moonshot', () => {
    expect(resolveProvider('kimi-k2-5').id).toBe('moonshot');
  });

  test('falls back to OpenAI for unrecognized prefixes', () => {
    expect(resolveProvider('gpt-5.4').id).toBe('openai');
    expect(resolveProvider('totally-unknown-model').id).toBe('openai');
    expect(resolveProvider('').id).toBe('openai');
  });
});

describe('getProviderById', () => {
  test('returns the provider by canonical id', () => {
    expect(getProviderById('anthropic')?.displayName).toBe('Anthropic');
    expect(getProviderById('ollama')?.id).toBe('ollama');
  });

  test('returns undefined for unknown id', () => {
    expect(getProviderById('does-not-exist')).toBeUndefined();
  });

  test('returns the same fastModel as listed in the registry', () => {
    expect(getProviderById('openai')?.fastModel).toBe('gpt-4.1');
    expect(getProviderById('anthropic')?.fastModel).toBe('claude-haiku-4-5');
  });
});

describe('OLLAMA_NUM_CTX constant', () => {
  test('is set to 65536 (65K) — matches numCtx in llm.ts', () => {
    expect(OLLAMA_NUM_CTX).toBe(65_536);
  });
});
