#!/usr/bin/env bash
# Installs TrackerMaxxing (`trackermaxxing` / `tmaxing`) and puts it on PATH.
#
#   curl -fsSL https://raw.githubusercontent.com/desenyon/trackermaxxing/main/install.sh | bash
#
set -euo pipefail

REPO_URL="https://github.com/desenyon/trackermaxxing.git"
INSTALL_DIR="$HOME/.trackermaxxing/cli"
BIN_DIR="$HOME/.local/bin"

info()  { printf '\033[1;35m==>\033[0m %s\n' "$1"; }
ok()    { printf '\033[1;32m✓\033[0m %s\n' "$1"; }
fail()  { printf '\033[1;31m✗\033[0m %s\n' "$1" >&2; exit 1; }

command -v node >/dev/null 2>&1 || fail "Node.js is required. Install it from https://nodejs.org (v22.12+; Node 24 LTS recommended) and re-run this script."
command -v npm  >/dev/null 2>&1 || fail "npm is required (it ships with Node.js)."
command -v git  >/dev/null 2>&1 || fail "git is required."

node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1)' || fail "Node.js 22.12+ is required. Upgrade and re-run."

if [ -d "$INSTALL_DIR/.git" ]; then
  info "Updating existing install at $INSTALL_DIR"
  git -C "$INSTALL_DIR" pull --ff-only
else
  info "Cloning trackermaxxing to $INSTALL_DIR"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi

info "Installing dependencies"
(cd "$INSTALL_DIR" && npm ci --no-fund --no-audit --silent)

info "Building"
(cd "$INSTALL_DIR" && npm run build --silent)
chmod +x "$INSTALL_DIR/dist/cli.js"

mkdir -p "$BIN_DIR"
ln -sf "$INSTALL_DIR/dist/cli.js" "$BIN_DIR/trackermaxxing"
ln -sf "$INSTALL_DIR/dist/cli.js" "$BIN_DIR/tmaxing"
ok "Linked trackermaxxing and tmaxing into $BIN_DIR"

PATH_LINE="export PATH=\"$BIN_DIR:\$PATH\""
add_to_rc() {
  local rc="$1"
  [ -f "$rc" ] || return 0
  grep -qF "$BIN_DIR" "$rc" 2>/dev/null && return 0
  printf '\n# Added by trackermaxxing installer\n%s\n' "$PATH_LINE" >> "$rc"
  ok "Added $BIN_DIR to PATH in $rc"
}

case "${SHELL:-}" in
  */zsh)  add_to_rc "$HOME/.zshrc" ;;
  */bash) add_to_rc "$HOME/.bashrc"; add_to_rc "$HOME/.bash_profile" ;;
  *)      add_to_rc "$HOME/.profile" ;;
esac

case ":$PATH:" in
  *":$BIN_DIR:"*)
    echo ""
    ok "Installed. Run: trackermaxxing setup"
    ;;
  *)
    echo ""
    ok "Installed. Open a new terminal (or run: source ~/.zshrc), then: trackermaxxing setup"
    ;;
esac
