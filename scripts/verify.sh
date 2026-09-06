#!/usr/bin/env bash
# Linux/macOS counterpart of verify.ps1: the Rust workspace checks CI runs.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
