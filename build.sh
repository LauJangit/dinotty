#!/usr/bin/env bash
set -euo pipefail

BIN="xterm-server"
DIST="dist"

PLATFORMS=(
    "x86_64-unknown-linux-musl"
    "aarch64-unknown-linux-musl"
    "x86_64-apple-darwin"
    "aarch64-apple-darwin"
)

info()  { echo -e "\033[1;34m[INFO]\033[0m  $*"; }
ok()    { echo -e "\033[1;32m[ OK ]\033[0m  $*"; }
warn()  { echo -e "\033[1;33m[WARN]\033[0m  $*"; }
die()   { echo -e "\033[1;31m[ERR ]\033[0m  $*" >&2; exit 1; }

usage() {
    cat <<EOF
Usage: $0 [COMMAND] [TARGET ...]

Commands:
  native      Build for the current host (release)
  cross       Cross-compile for all targets (or specified targets)
  all         native + cross
  list        List supported targets
  clean       Remove dist/ and target/
  help        Show this message

Runtime usage (after build):
  ./xterm-server                  # listen on default port 8999
  ./xterm-server --port 9000      # listen on port 9000
  ./xterm-server -p 9000          # same

Supported targets:
$(printf '  %s\n' "${PLATFORMS[@]}")
EOF
}

need() { command -v "$1" &>/dev/null || die "Required tool not found: $1 — install it first"; }

is_windows() { [[ "$1" == *"windows"* ]]; }

bin_name() {
    if is_windows "$1"; then echo "${BIN}.exe"; else echo "$BIN"; fi
}

strip_bin() {
    local file="$1" target="${2:-}"
    if [[ "$target" == *"linux"* ]] || [[ "$target" == *"darwin"* ]]; then
        if command -v llvm-strip &>/dev/null; then
            llvm-strip "$file" 2>/dev/null || warn "llvm-strip failed for $file, skipping"
        elif command -v strip &>/dev/null; then
            strip "$file" 2>/dev/null || warn "strip failed for $file, skipping"
        fi
    fi
}

build_native() {
    info "Building native release..."
    need cargo

    cargo build --release

    mkdir -p "$DIST"
    local host; host="$(rustc -vV | awk '/^host:/{print $2}')"
    local bin; bin="$(bin_name "$host")"
    local src="target/release/$bin"
    local dest="$DIST/${BIN}-${host}"
    is_windows "$host" && dest="${dest}.exe"

    cp "$src" "$dest"
    strip_bin "$dest" "$host"
    ok "Native binary: $dest"
}

build_one_target() {
    local target="$1"
    info "  Target: $target"

    if ! rustup target list --installed | grep -q "^${target}$"; then
        info "  Installing Rust target $target..."
        rustup target add "$target"
    fi

    if command -v cargo-zigbuild &>/dev/null; then
        cargo zigbuild --release --target "$target"
    elif command -v cross &>/dev/null; then
        cross build --release --target "$target"
    else
        warn "Neither cargo-zigbuild nor cross found; trying plain cargo (may fail for cross targets)"
        cargo build --release --target "$target"
    fi

    mkdir -p "$DIST"
    local bin; bin="$(bin_name "$target")"
    local src="target/${target}/release/$bin"
    local dest="$DIST/${BIN}-${target}"
    is_windows "$target" && dest="${dest}.exe"

    cp "$src" "$dest"
    strip_bin "$dest" "$target"
    ok "Binary: $dest"
}

build_cross() {
    info "Cross-compiling..."
    need cargo
    need rustup

    local targets=()
    if [[ $# -gt 0 ]]; then
        targets=("$@")
    elif [[ -n "${CROSS_TARGETS:-}" ]]; then
        read -ra targets <<< "$CROSS_TARGETS"
    else
        targets=("${PLATFORMS[@]}")
    fi

    for target in "${targets[@]}"; do
        build_one_target "$target"
    done
}

cmd_list() {
    echo "Supported targets:"
    local idx=1
    for p in "${PLATFORMS[@]}"; do
        printf "  %2d) %s\n" "$idx" "$p"
        idx=$((idx + 1))
    done
}

cmd_clean() {
    info "Cleaning dist/ and target/..."
    rm -rf "$DIST"
    cargo clean
    ok "Clean done"
}

case "${1:-}" in
    native) build_native ;;
    cross)  shift; build_cross "$@" ;;
    all)    shift; build_native; build_cross "$@" ;;
    list)   cmd_list ;;
    clean)  cmd_clean ;;
    help|-h|--help) usage ;;
    *) die "Unknown command: ${1:-} — run '$0 help' for usage" ;;
esac
