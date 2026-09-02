#!/usr/bin/env bash
# Builds the arm64 release binary and prints its path.
set -euo pipefail

cd "$(dirname "$0")"
swift build -c release --arch arm64 1>&2

BINARY="$(pwd)/.build/arm64-apple-macosx/release/apprentice-helper"
if [ ! -x "$BINARY" ]; then
  echo "[build.sh] expected binary not found at $BINARY" >&2
  exit 1
fi
echo "$BINARY"
