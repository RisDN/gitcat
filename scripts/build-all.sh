#!/usr/bin/env bash
# Linux/macOS counterpart of build-all.ps1: install, verify, then build the
# native release with Tauri. Stops at the first failing step.
set -euo pipefail

skip_install=false
skip_verify=false
no_bundle=false
for arg in "$@"; do
    case "$arg" in
        --skip-install) skip_install=true ;;
        --skip-verify) skip_verify=true ;;
        --no-bundle) no_bundle=true ;;
        -h|--help)
            echo "usage: $0 [--skip-install] [--skip-verify] [--no-bundle]"
            exit 0
            ;;
        *)
            echo "unknown option: $arg" >&2
            exit 2
            ;;
    esac
done

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
desktop_dir="$repo_root/apps/desktop"
step=0
started_at=$(date +%s)

run_step() {
    local name=$1 cwd=$2
    shift 2
    step=$((step + 1))
    printf '\n\033[36m==> [%d] %s\033[0m\n' "$step" "$name"
    printf '\033[90m    %s  (cwd: %s)\033[0m\n' "$*" "$cwd"
    if ! (cd "$cwd" && "$@"); then
        local code=$?
        printf '\033[31mFAILED: %s (exit %d)\033[0m\n' "$name" "$code"
        exit "$code"
    fi
}

if [ "$skip_install" = false ]; then
    if [ -f "$desktop_dir/package-lock.json" ]; then
        run_step "Frontend dependencies (npm ci)" "$desktop_dir" npm ci
    else
        run_step "Frontend dependencies (npm install)" "$desktop_dir" npm install
    fi
fi

if [ "$skip_verify" = false ]; then
    run_step "cargo fmt --all --check" "$repo_root" cargo fmt --all --check
    run_step "cargo clippy -D warnings" "$repo_root" cargo clippy --workspace --all-targets -- -D warnings
    run_step "cargo test --workspace" "$repo_root" cargo test --workspace
    run_step "TypeScript typecheck" "$desktop_dir" npm run typecheck
fi

if [ "$no_bundle" = true ]; then
    run_step "Tauri release build" "$desktop_dir" npm run tauri build -- --no-bundle
else
    run_step "Tauri release build" "$desktop_dir" npm run tauri build
fi

elapsed=$(( $(date +%s) - started_at ))
printf '\n\033[32mAll build steps completed in %d min %d s.\033[0m\n' $((elapsed / 60)) $((elapsed % 60))
echo "  web:      apps/desktop/dist"
echo "  binary:   target/release/gitcat-desktop"
if [ "$no_bundle" = false ]; then
    echo "  bundles:  target/release/bundle"
fi
