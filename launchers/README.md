# Desktop launchers

Alesia is a terminal UI, so these do not hide the terminal — they open one and start the agent in it. That is the intended behaviour, not a shortcut.

```bash
./launchers/build.sh            # everything buildable here
./launchers/build.sh macos      # Alesia.app
./launchers/build.sh windows    # Alesia.exe
```

## macOS — `Alesia.app`

```bash
./launchers/build.sh macos
```

Produces `Alesia.app` at the repository root. **Drag it onto your Dock.**

The bundle itself does almost nothing: it hands `alesia-run.command` to Terminal, which is where the agent actually runs. A TUI started inside the bundle would have no tty at all.

> **The pitfall this exists to avoid.** An app launched from the Dock inherits a bare environment and never sources `~/.zshrc`, so a Bun installed in `~/.bun/bin` is invisible to it — its PATH is `/usr/gnu/bin:/usr/local/bin:/bin:/usr/bin:.` and nothing more. A launcher that simply calls `bun` works perfectly from a terminal and fails from the Dock, which is the one place it was written for. Routing through Terminal solves it (Terminal loads your profile), and `alesia-run.command` also probes `~/.bun/bin`, `/opt/homebrew/bin` and `/usr/local/bin` directly as insurance.

`Alesia.app` is **not committed**: it embeds an absolute path valid only on the machine that built it. Rebuild it after moving the repository.

**Icon.** There is none, so the Dock shows the generic app icon. To set one: select `Alesia.app`, press `Cmd-I`, drag any image onto the small icon at the top left of the info panel.

## Windows — `Alesia.cmd` and `Alesia.exe`

**`Alesia.cmd` is committed and needs no build.** Double-click it. 1 KB, no compilation, nothing to trust.

```bash
./launchers/build.sh windows    # optional, produces Alesia.exe
```

The `.exe` does the *identical* job in 112 MB, because `bun --compile` embeds the entire Bun runtime — and you already need Bun installed for either launcher to work, so it ships a second copy of Bun to do nothing.

**The one thing it buys:** Windows pins an `.exe` straight to the taskbar and refuses to pin a `.cmd`. That is the whole justification, and it is cosmetic. Use the `.cmd` unless you specifically want the taskbar icon.

Two caveats worth stating plainly:

- It is **cross-compiled from macOS and has never been run.** The build verifies it is a valid PE binary; it cannot verify it works, because a Windows executable cannot be executed on macOS.
- It is **not committed** — at 112 MB it is above GitHub's hard per-file limit.

Keep `Alesia.exe` inside `launchers/`, or set `ALESIA_HOME` to the repository path if you move it elsewhere.

## What none of these are

A portable, self-contained build. Alesia depends on `better-sqlite3` (a native addon) and Playwright (an out-of-band browser download), neither of which survives being frozen into a single file. These launchers spawn the real installation; they do not replace it.

Every launcher performs the same checks before starting, and each failure prints a readable reason instead of a window that vanishes:

1. the repository is where the launcher expects it
2. `bun` is installed and reachable
3. `node_modules` exists, and runs `bun install` on the first launch if not
4. `.env` exists — a warning only, since the backtest studies need no API key
