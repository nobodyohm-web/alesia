import { lstat } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve as resolvePath } from 'node:path';
import { resolveToCwd } from './utils/path-utils.js';

// The sandbox root is the working directory, which is also where the agent's
// own secrets live (.env, WhatsApp session credentials, pairing state). Staying
// inside the root is therefore not enough: these paths are denied outright so
// that neither the model nor injected content can read or overwrite them.
const DENIED_DIRECTORY_SEGMENTS = new Set(['.ssh', '.aws', '.gnupg']);

const DENIED_ALESIA_SUBDIRS = new Set(['credentials', 'pairing', 'sessions']);

const DENIED_ALESIA_FILES = new Set(['settings.json', 'gateway.json', 'jobs.json']);

const DENIED_FILENAMES = new Set([
  '.npmrc',
  '.netrc',
  '.git-credentials',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
]);

const DENIED_EXTENSIONS = ['.pem', '.p12', '.pfx', '.jks', '.keystore'];

/**
 * Reject paths pointing at credentials or agent configuration, even when they
 * resolve inside the sandbox root.
 *
 * @param relativePath - Path relative to the sandbox root
 * @throws Error if the path targets a protected file
 */
function assertNotProtectedPath(relativePath: string, original: string): void {
  const segments = relativePath.split(/[\\/]/).filter(Boolean);
  if (segments.length === 0) {
    return;
  }

  const deny = (): never => {
    throw new Error(`Access to protected path is not allowed: ${original}`);
  };

  for (const [index, segment] of segments.entries()) {
    const lower = segment.toLowerCase();

    if (DENIED_DIRECTORY_SEGMENTS.has(lower)) deny();

    // .env, .env.local, .env.production, ...
    if (lower === '.env' || lower.startsWith('.env.')) deny();

    if (lower === '.alesia') {
      const next = segments[index + 1]?.toLowerCase();
      if (next && (DENIED_ALESIA_SUBDIRS.has(next) || DENIED_ALESIA_FILES.has(next))) deny();
    }
  }

  const file = basename(relativePath).toLowerCase();
  if (DENIED_FILENAMES.has(file)) deny();
  if (DENIED_EXTENSIONS.some((ext) => file.endsWith(ext))) deny();
}

export function resolveSandboxPath(params: { filePath: string; cwd: string; root: string }): {
  resolved: string;
  relative: string;
} {
  const resolved = resolveToCwd(params.filePath, params.cwd);
  const rootResolved = resolvePath(params.root);
  const rel = relative(rootResolved, resolved);

  if (!rel || rel === '') {
    return { resolved, relative: '' };
  }

  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Path escapes sandbox root: ${params.filePath}`);
  }

  assertNotProtectedPath(rel, params.filePath);

  return { resolved, relative: rel };
}

export async function assertSandboxPath(params: {
  filePath: string;
  cwd: string;
  root?: string;
}): Promise<{ resolved: string; relative: string }> {
  const root = params.root ?? params.cwd;
  const resolved = resolveSandboxPath({ filePath: params.filePath, cwd: params.cwd, root });
  await assertNoSymlink(resolved.relative, resolvePath(root));
  return resolved;
}

async function assertNoSymlink(relativePath: string, root: string): Promise<void> {
  if (!relativePath) {
    return;
  }

  const parts = relativePath.split(/[\\/]/).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) {
        throw new Error(`Symlink not allowed in sandbox path: ${current}`);
      }
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'ENOENT') {
        return;
      }
      throw err;
    }
  }
}
