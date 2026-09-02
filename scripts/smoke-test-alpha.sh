#!/usr/bin/env bash
# Alpha smoke test: verifies the bundle without downloading any model.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE="${1:-$ROOT/dist/alpha}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok   $*"; }

[ -d "$BUNDLE" ] || fail "bundle directory $BUNDLE not found (run pnpm alpha:bundle)"
cd "$BUNDLE"
for f in SHA256SUMS.txt manifest.json ALPHA_TEST_GUIDE.md KNOWN_LIMITATIONS.md PRIVACY_SUMMARY.md RELEASE_NOTES.md; do
  [ -f "$f" ] || fail "missing $f"
done
pass "required documents present"
ls *.dmg >/dev/null 2>&1 || fail "no .dmg in bundle"
ls *.zip >/dev/null 2>&1 || fail "no .zip in bundle"
shasum -a 256 -c SHA256SUMS.txt >/dev/null || fail "checksum mismatch"
pass "checksums verified"

APPZIP="$(ls *.zip | grep -v extension | head -1)"
EXTZIP="$(ls *extension*.zip | head -1)"
[ -n "$APPZIP" ] || fail "desktop zip not found"
[ -n "$EXTZIP" ] || fail "extension zip not found"

unzip -q "$EXTZIP" -d "$TMP/ext"
[ -f "$TMP/ext/manifest.json" ] || fail "extension zip lacks manifest.json"
grep -q '"manifest_version": *3' "$TMP/ext/manifest.json" || fail "extension manifest is not MV3"
grep -q '"incognito": *"not_allowed"' "$TMP/ext/manifest.json" || fail "extension must not allow incognito"
pass "extension zip is MV3 without incognito access"

ditto -x -k "$APPZIP" "$TMP/app"
APP="$(find "$TMP/app" -maxdepth 2 -name '*.app' | head -1)"
[ -n "$APP" ] || fail "no .app inside $APPZIP"
codesign --verify --deep --strict "$APP" || fail "codesign verification failed"
SIGNER="$(codesign -dv "$APP" 2>&1 | grep -E '^Authority=|^Signature=' | head -1 || true)"
pass "code signature valid ($SIGNER)"
if spctl -a -vv "$APP" >/dev/null 2>&1; then
  pass "Gatekeeper assessment: accepted (notarized)"
else
  echo "info Gatekeeper assessment: not accepted (expected for an unnotarized alpha build; see ALPHA_TEST_GUIDE.md)"
fi
ARCH="$(lipo -archs "$APP/Contents/MacOS/"* 2>/dev/null | head -1)"
echo "$ARCH" | grep -q arm64 || fail "app binary is not arm64 ($ARCH)"
pass "arm64 binary"

HELPER="$APP/Contents/Resources/helper/apprentice-helper"
[ -x "$HELPER" ] || fail "helper binary missing at $HELPER"
"$HELPER" --self-test | grep -q '"ok":true' || fail "helper self-test failed"
pass "native helper self-test"

# Headless product smoke: opens a temp data dir, loads demo data, discovers a
# candidate, converts to a skill, runs a mock guided run, exports feedback.
export APPRENTICE_DATA_DIR="$TMP/data"
export APPRENTICE_SMOKE_TEST=1
OUT="$("$APP/Contents/MacOS/Apprentice" --smoke-test 2>"$TMP/smoke.err" || true)"
echo "$OUT" | grep -q '"ok":true' || { cat "$TMP/smoke.err" | tail -20; fail "in-app smoke test did not report ok: $OUT"; }
pass "in-app smoke test: $OUT"
echo "ALPHA SMOKE TEST PASSED"
