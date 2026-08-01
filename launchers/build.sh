#!/bin/bash
# Build the desktop launchers.
#
#   ./launchers/build.sh            # everything buildable on this machine
#   ./launchers/build.sh macos      # Alesia.app  -> drag to the Dock
#   ./launchers/build.sh windows    # Alesia.exe  -> pin to the taskbar
#
# Both artefacts are generated, never committed: the .app embeds an absolute
# path that is only valid on the machine that built it, and the .exe is 112 MB,
# which is above GitHub's hard per-file limit anyway.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
TARGET="${1:-all}"

info() { printf '\033[36m%s\033[0m\n' "$1"; }
ok()   { printf '\033[32m  ✓ %s\033[0m\n' "$1"; }
warn() { printf '\033[33m  ! %s\033[0m\n' "$1"; }

build_macos() {
  local app="$REPO/Alesia.app"
  info "Building $app"

  rm -rf "$app"
  mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"

  # The version comes from package.json so the bundle cannot drift from it.
  local version
  version="$(grep -m1 '"version"' "$REPO/package.json" | sed 's/.*"version": *"\([^"]*\)".*/\1/')"

  cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleName</key><string>Alesia</string>
	<key>CFBundleDisplayName</key><string>Alesia</string>
	<key>CFBundleIdentifier</key><string>com.nobodyohm.alesia</string>
	<key>CFBundleExecutable</key><string>Alesia</string>
	<key>CFBundlePackageType</key><string>APPL</string>
	<key>CFBundleVersion</key><string>$version</string>
	<key>CFBundleShortVersionString</key><string>$version</string>
	<key>CFBundleIconFile</key><string>Alesia</string>
	<key>LSMinimumSystemVersion</key><string>11.0</string>
	<key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

  # The bundle's job is only to hand the real launcher to Terminal. Running the
  # TUI inside the bundle itself would give it no tty at all.
  #
  # The path is absolute because a Dock item is a reference to this bundle from
  # anywhere on the system, so nothing relative is meaningful once it is there.
  cat > "$app/Contents/MacOS/Alesia" <<LAUNCH
#!/bin/bash
exec open -a Terminal "$HERE/alesia-run.command"
LAUNCH

  chmod +x "$app/Contents/MacOS/Alesia"
  chmod +x "$HERE/alesia-run.command"

  plutil -lint "$app/Contents/Info.plist" >/dev/null && ok "Info.plist is valid"

  # Re-register with Launch Services, otherwise Finder can keep showing a stale
  # name or icon for a bundle that was rebuilt in place.
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
    -f "$app" 2>/dev/null || true

  if ALESIA_LAUNCHER_CHECK=1 "$HERE/alesia-run.command" | grep -q "launcher OK"; then
    ok "launcher resolves the repo and finds bun"
  else
    warn "the launcher's own checks did not pass — run it directly to see why"
  fi

  if [ ! -f "$app/Contents/Resources/Alesia.icns" ]; then
    warn "no icon: the Dock will show the generic app icon"
    warn "to set one: select Alesia.app, Cmd-I, drag any image onto the icon at the top left"
  fi

  ok "built $app"
  info "Drag Alesia.app onto your Dock."
}

build_windows() {
  local out="$HERE/Alesia.exe"
  info "Building $out (cross-compiled for Windows x64)"

  bun build --compile --target=bun-windows-x64 \
    "$HERE/windows-launcher.ts" --outfile "$out" >/dev/null

  [ -f "$out" ] || { warn "compilation produced no file"; return 1; }

  # A PE binary starts with "MZ". Checking that is the only verification
  # available here — a Windows executable cannot be run on macOS to prove it works.
  if [ "$(head -c 2 "$out")" = "MZ" ]; then
    ok "valid PE executable, $(du -h "$out" | cut -f1)"
  else
    warn "output is not a PE executable"
  fi

  warn "UNTESTED: built on macOS, so it has never been run. Alesia.cmd is the"
  warn "path that needs no build and no trust — the .exe only exists because"
  warn "Windows will not pin a .cmd to the taskbar."
  ok "built $out — keep it in launchers/, or set ALESIA_HOME if you move it"
}

case "$TARGET" in
  macos)   build_macos ;;
  windows) build_windows ;;
  all)
    [ "$(uname)" = "Darwin" ] && build_macos || warn "skipping macOS bundle: not on macOS"
    build_windows
    ;;
  *) echo "usage: $0 [macos|windows|all]" >&2; exit 2 ;;
esac
