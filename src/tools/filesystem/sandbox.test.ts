import { describe, test, expect } from 'bun:test';
import { resolveSandboxPath } from './sandbox.js';

const ROOT = '/workspace';

const resolve = (filePath: string) => resolveSandboxPath({ filePath, cwd: ROOT, root: ROOT });

describe('resolveSandboxPath', () => {
  test('accepts a normal file inside the root', () => {
    expect(resolve('reports/nvda.md').relative).toBe('reports/nvda.md');
  });

  test('rejects paths escaping the root', () => {
    expect(() => resolve('../etc/passwd')).toThrow(/escapes sandbox root/);
    expect(() => resolve('/etc/passwd')).toThrow(/escapes sandbox root/);
  });

  // The sandbox root is the working directory, which is also where the agent's
  // own secrets live. Staying inside the root is not enough.
  describe('protected paths', () => {
    const denied = [
      '.env',
      '.env.local',
      '.env.production',
      'nested/.env',
      '.alesia/credentials/whatsapp/1/creds.json',
      '.alesia/pairing/whatsapp.json',
      '.alesia/sessions/state.json',
      '.alesia/settings.json',
      '.alesia/gateway.json',
      '.alesia/jobs.json',
      '.ssh/id_rsa',
      '.aws/credentials',
      'certs/server.pem',
      'keys/id_ed25519',
      '.npmrc',
      '.git-credentials',
    ];

    for (const path of denied) {
      test(`rejects ${path}`, () => {
        expect(() => resolve(path)).toThrow(/protected path/);
      });
    }

    test('rejection is case-insensitive', () => {
      expect(() => resolve('.ENV')).toThrow(/protected path/);
      expect(() => resolve('certs/SERVER.PEM')).toThrow(/protected path/);
    });

    test('rejects protected paths reached through traversal that lands back inside', () => {
      expect(() => resolve('reports/../.env')).toThrow(/protected path/);
    });

    test('still allows unrelated files under .alesia', () => {
      expect(resolve('.alesia/RULES.md').relative).toBe('.alesia/RULES.md');
      expect(resolve('.alesia/scratchpad/run.jsonl').relative).toBe('.alesia/scratchpad/run.jsonl');
    });

    test('does not reject names that merely start with env', () => {
      expect(resolve('env.example').relative).toBe('env.example');
      expect(resolve('environment.md').relative).toBe('environment.md');
    });
  });
});
