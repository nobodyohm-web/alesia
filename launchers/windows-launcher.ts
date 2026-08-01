/**
 * Source of Alesia.exe — Windows.
 *
 * Compiled with `bun build --compile --target=bun-windows-x64` (see build.sh).
 *
 * WHY A 112 MB BINARY EXISTS TO SPAWN A PROGRAM YOU ALREADY HAVE: `bun
 * --compile` embeds the whole Bun runtime, and since you need Bun installed to
 * run Alesia anyway, this ships a second copy of it to do nothing. Alesia.cmd
 * does the identical job in 1 KB. The one thing the .exe buys is that Windows
 * pins an .exe to the taskbar directly and refuses to pin a .cmd. That is the
 * entire justification, and it is a cosmetic one — use the .cmd unless you
 * specifically want the taskbar icon.
 *
 * This deliberately does NOT bundle the agent itself. Alesia depends on
 * better-sqlite3 (a native addon) and Playwright (an out-of-band browser
 * download), neither of which survives being frozen into a single file. A
 * launcher that spawns the real thing is honest about what it is; a "portable
 * build" that breaks on first use is not.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

/** Block so a double-clicked window does not vanish before the error is read. */
function pause(): void {
  process.stdout.write('\nPress Return to close this window.');
  try {
    // Reading fd 0 synchronously is the only way to hold a console open here;
    // Bun's async stdin would let the process exit first. Imported statically
    // rather than require()'d — this file is ESM, and it is never run on the
    // machine that builds it, so a runtime resolution failure would surface to
    // the user rather than to me.
    readSync(0, Buffer.alloc(1), 0, 1, null);
  } catch {
    /* no console attached — nothing to hold open */
  }
}

function die(message: string): never {
  console.error(`\n${RED}${message}${RESET}`);
  pause();
  process.exit(1);
}

/**
 * Walk up from the executable looking for the repository, so the launcher keeps
 * working whether it sits in launchers/ or at the repository root.
 */
function findRepo(): string {
  const override = process.env.ALESIA_HOME;
  if (override && existsSync(join(override, 'package.json'))) return override;

  let dir = dirname(process.execPath);
  for (let depth = 0; depth < 4; depth++) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'src'))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  die(
    `Alesia not found near ${process.execPath}.\n` +
      `Keep Alesia.exe inside the repository, or set ALESIA_HOME to its path.`,
  );
}

function run(command: string, args: string[], cwd: string): number {
  // shell: true because `bun` on Windows is resolved through PATHEXT.
  const r = spawnSync(command, args, { cwd, stdio: 'inherit', shell: true });
  return r.status ?? 1;
}

function main(): void {
  const repo = findRepo();

  if (run('bun', ['--version'], repo) !== 0) {
    die('bun is not installed. Install it with:\n  powershell -c "irm bun.sh/install.ps1|iex"');
  }

  if (!existsSync(join(repo, 'node_modules'))) {
    console.log(`${YELLOW}First run: installing dependencies...${RESET}`);
    if (run('bun', ['install'], repo) !== 0) die('bun install failed.');
  }

  if (!existsSync(join(repo, '.env'))) {
    console.log(
      `${YELLOW}No .env found. Copy env.example to .env and add an API key,\n` +
        `or press Return to continue anyway (the backtests need no key).${RESET}`,
    );
    pause();
  }

  console.log(`${CYAN}Alesia${RESET} — ${repo}\n`);
  const code = run('bun', ['start'], repo);
  if (code !== 0) pause();
  process.exit(code);
}

main();
