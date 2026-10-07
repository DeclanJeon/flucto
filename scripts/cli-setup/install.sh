#!/bin/sh
# One-shot user-scope Flucto CLI installer for macOS and Linux.
#
# Installs a private Node.js 24 LTS runtime (downloaded from nodejs.org and
# verified against its official SHASUMS256.txt) directly into the install
# prefix, installs the bundled Flucto npm tarball under that prefix, registers
# the user PATH in shell profiles (no admin), and runs `flucto setup` +
# `flucto doctor` to provision yt-dlp and FFmpeg into a prefix-private bin
# directory. No system Node.js or npm is required.
#
# Resulting layout (InstallDir is the npm prefix AND the Node root):
#   InstallDir/bin/{node,npm,npx,flucto,yt-dlp,ffmpeg}
#   InstallDir/lib/node_modules/{npm,flucto}
#   InstallDir/flucto-cli-install.json
#
# Usage:
#   ./install.sh [--install-dir PATH] [--no-profile]
set -eu

INSTALL_DIR=""
NO_PROFILE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --install-dir)
      [ $# -ge 2 ] || { echo "[flucto] ERROR: --install-dir requires a path" >&2; exit 1; }
      INSTALL_DIR="$2"; shift 2 ;;
    --install-dir=*)
      INSTALL_DIR="${1#*=}"; shift ;;
    --no-profile)
      NO_PROFILE=1; shift ;;
    -h|--help)
      sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *)
      echo "[flucto] ERROR: unknown argument: $1" >&2; exit 1 ;;
  esac
done

info() { printf '%s\n' "[flucto] $1"; }
fail() { printf '%s\n' "[flucto] ERROR: $1" >&2; exit 1; }

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TARBALL=""
for candidate in "$SCRIPT_DIR"/*.tgz; do
  if [ -f "$candidate" ]; then TARBALL="$candidate"; break; fi
done
[ -n "$TARBALL" ] || fail "No npm package tarball (*.tgz) found next to install.sh — this archive is incomplete."

OS=$(uname -s)
case "$OS" in
  Darwin|Linux) ;;
  *) fail "Unsupported OS '$OS' — use install.cmd on Windows." ;;
esac

if [ -z "$INSTALL_DIR" ]; then
  if [ "$OS" = "Darwin" ]; then
    INSTALL_DIR="$HOME/Library/Application Support/Flucto/cli"
  else
    INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/flucto/cli"
  fi
fi
mkdir -p "$INSTALL_DIR" || fail "Cannot create install directory: $INSTALL_DIR"
INSTALL_DIR=$(CDPATH= cd "$INSTALL_DIR" && pwd)
# Node extracts straight into the prefix: InstallDir/bin/node + InstallDir/lib/node_modules.
NODE_BIN_DIR="$INSTALL_DIR/bin"
BIN_DIR="$INSTALL_DIR/bin"
MARKER="$INSTALL_DIR/flucto-cli-install.json"
mkdir -p "$BIN_DIR"

# Only x64 and arm64 hosts are supported.
ARCH=$(uname -m)
case "$ARCH" in
  x86_64|amd64) NODE_ARCH="x64" ;;
  arm64|aarch64) NODE_ARCH="arm64" ;;
  *) fail "Unsupported CPU architecture '$ARCH' — Flucto CLI requires x64 or arm64." ;;
esac
case "$OS" in
  Darwin) NODE_PLATFORM="darwin" ;;
  *) NODE_PLATFORM="linux" ;;
esac

info "Installing Flucto CLI into $INSTALL_DIR"

download() {
  url="$1"; dest="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 2 -o "$dest" "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$dest" "$url"
  else
    fail "curl or wget is required to download Node.js."
  fi
}

sha256_of() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    fail "shasum or sha256sum is required to verify the Node.js download."
  fi
}

TMPDIR_DL=""
cleanup() { [ -n "$TMPDIR_DL" ] && rm -rf "$TMPDIR_DL"; return 0; }
trap cleanup EXIT

# --- Private Node.js 24 LTS runtime ------------------------------------------
if [ -x "$NODE_BIN_DIR/node" ]; then
  info "Private Node.js already present: $("$NODE_BIN_DIR/node" --version)"
else
  INDEX_URL="https://nodejs.org/dist/latest-v24.x/"
  info "Resolving Node.js 24 LTS from $INDEX_URL"
  TMPDIR_DL=$(mktemp -d "${TMPDIR:-/tmp}/flucto-node.XXXXXX")
  download "${INDEX_URL}SHASUMS256.txt" "$TMPDIR_DL/SHASUMS256.txt" \
    || fail "Failed to download Node.js SHASUMS256.txt"
  LINE=$(grep "node-v[0-9.]*-$NODE_PLATFORM-$NODE_ARCH.tar.gz" "$TMPDIR_DL/SHASUMS256.txt" | head -1)
  [ -n "$LINE" ] || fail "No $NODE_PLATFORM-$NODE_ARCH tarball listed in $INDEX_URL SHASUMS256.txt"
  EXPECTED=$(printf '%s' "$LINE" | awk '{print $1}' | tr 'A-F' 'a-f')
  NODE_FILE=$(printf '%s' "$LINE" | awk '{print $NF}')
  [ -n "$EXPECTED" ] && [ -n "$NODE_FILE" ] || fail "Could not parse SHASUMS256.txt entry: $LINE"

  info "Downloading $NODE_FILE"
  download "$INDEX_URL$NODE_FILE" "$TMPDIR_DL/$NODE_FILE" || fail "Failed to download $NODE_FILE"
  ACTUAL=$(sha256_of "$TMPDIR_DL/$NODE_FILE")
  [ "$ACTUAL" = "$EXPECTED" ] || fail "SHA256 mismatch for $NODE_FILE (expected $EXPECTED, got $ACTUAL) — download aborted."

  info "Checksum verified; extracting private runtime into $INSTALL_DIR"
  tar -xzf "$TMPDIR_DL/$NODE_FILE" -C "$TMPDIR_DL" || fail "Failed to extract $NODE_FILE"
  NODE_EXTRACTED="$TMPDIR_DL/${NODE_FILE%.tar.gz}"
  [ -d "$NODE_EXTRACTED" ] || fail "Extracted Node directory not found."
  cp -R "$NODE_EXTRACTED/." "$INSTALL_DIR/" || fail "Failed to copy Node runtime into $INSTALL_DIR"
  rm -rf "$TMPDIR_DL"; TMPDIR_DL=""
  [ -x "$NODE_BIN_DIR/node" ] || fail "Node.js extraction failed — bin/node not found under $INSTALL_DIR."
  info "Installed private Node.js $("$NODE_BIN_DIR/node" --version)"
fi

NPM_CLI="$INSTALL_DIR/lib/node_modules/npm/bin/npm-cli.js"
[ -f "$NPM_CLI" ] || fail "npm CLI missing from private Node runtime: $NPM_CLI"

# --- Flucto CLI under the same user prefix ------------------------------------
info "Installing $(basename "$TARBALL") with the private npm"
"$NODE_BIN_DIR/node" "$NPM_CLI" install -g --prefix "$INSTALL_DIR" --loglevel warn "$TARBALL" \
  || fail "npm install of $(basename "$TARBALL") failed."

FLUCTO="$BIN_DIR/flucto"
if [ ! -f "$FLUCTO" ]; then fail "npm install did not produce $FLUCTO"; fi
chmod +x "$FLUCTO" 2>/dev/null || true

VERSION=$(basename "$TARBALL" .tgz | sed 's/^flucto-//')
cat > "$MARKER" <<EOF
{"fluctoCliPrivateInstall":true,"version":"$VERSION","prefix":"$INSTALL_DIR","binDir":"$BIN_DIR","nodeDir":"$INSTALL_DIR","platform":"$NODE_PLATFORM","installedAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
EOF

# --- User-scope PATH (no admin) ------------------------------------------------
export PATH="$BIN_DIR:$PATH"
export FLUCTO_BIN_DIR="$BIN_DIR"

PROFILE_LINE='export PATH="'"$BIN_DIR"':$PATH"'
add_profile_line() {
  file="$1"
  [ -n "$file" ] || return 0
  touch "$file" 2>/dev/null || return 0
  grep -Fqs "$BIN_DIR" "$file" || printf '\n# Flucto CLI\n%s\n' "$PROFILE_LINE" >> "$file"
}

if [ "$NO_PROFILE" -eq 0 ]; then
  if [ "$OS" = "Darwin" ]; then
    add_profile_line "$HOME/.zprofile"
    add_profile_line "$HOME/.zshrc"
    add_profile_line "$HOME/.bash_profile"
  else
    add_profile_line "$HOME/.profile"
    add_profile_line "$HOME/.bashrc"
  fi
  info "Registered user PATH entry: $BIN_DIR"
else
  info "--no-profile set — shell profiles, PATH and existing bin dirs left untouched."
fi

# --- Provision and verify media binaries (prefix-private bin dir) -------------
info "Provisioning yt-dlp and FFmpeg (flucto setup)"
"$FLUCTO" setup || fail "flucto setup failed — binaries were not provisioned."

info "Verifying install (flucto doctor --json)"
"$FLUCTO" doctor --json || fail "flucto doctor reported an unhealthy install."

info "Done. Installed command: $FLUCTO"
if [ "$NO_PROFILE" -eq 0 ]; then
  info "Open a new terminal (or source your profile) and run: flucto doctor"
else
  info "For this shell only: export PATH=\"$BIN_DIR:\$PATH\""
fi
