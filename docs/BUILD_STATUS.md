# Build status

Tested facts only. Updated as the alpha is assembled. "Verified" means the command was run on
the build machine described in `docs/BUILD_ENVIRONMENT.md` and produced the stated result.

## Status legend

- verified: run on this machine, output recorded below
- blocked: needs a credential or interactive macOS permission; manual step documented
- pending: not yet run

## Components

| Component | Status | Evidence |
|---|---|---|
| packages/schemas | verified | `pnpm --filter @apprentice/schemas test`: 9 tests pass; typecheck clean |
| native/mac-helper | verified | `swift build -c release --arch arm64` clean; `swift test`: 62 tests pass; `--self-test` ok; live SCK capture (3408x2160) and OCR (70 blocks) exercised |
| services/feedback-worker | verified | 35 tests pass under vitest-pool-workers; `wrangler deploy --dry-run` succeeds offline |
| apps/desktop storage layer | verified | `vitest run test/storage.test.ts`: 10 tests pass (node:sqlite, encryption at rest, key store) |
| packages/core | verified | `pnpm --filter @apprentice/core test`: 19 files, 128 tests pass; typecheck and eslint clean |
| packages/model-adapters | verified | 11 files, 115 tests pass incl. golden parity with official UI-Mate trajectory (12 steps) and byte-equal prompts; typecheck and eslint clean; local-model smoke test skipped by design when RUN_LOCAL_MODEL_TEST is unset |
| packages/test-fixtures | verified | 6 files, 282 tests pass; 26 fixture files rendered (1.05 MB) |
| apps/chromium-extension | verified | 17 files, 101 tests pass; `vite build` produces MV3 dist and `apprentice-extension.zip` (119 KB) |
| apps/desktop main process | verified | `vitest run test`: 17 files, 106 tests pass (real helper binary in fixture mode, loopback pairing, discovery, teach, run engine, feedback export + aggregator, privacy delete-all, runtime manager with fake llama-server, headless `--smoke-test` through the built app printing ok:true with 3 candidates and a 13-step completed run) |
| apps/desktop renderer | verified | 6 files, 52 tests pass; tsc web config clean; electron-vite build succeeds; UI exercised manually in a browser against the dev mock (light and dark) |
| scripts (runtime, model, bundle) | verified | `pnpm test:scripts`: 7 files, 39 tests pass; real llama.cpp b10752 download, sha256, extraction, and `--version` verified on this machine |
| e2e (Playwright, demo mode) | pending | |
| packaging (dmg, zip) | pending | |
| dist/alpha bundle | pending | |

## Top-level commands

| Command | Result (2026-09-02) |
|---|---|
| `pnpm install` | ok (pnpm 10.33.0, 8 workspace projects) |
| `pnpm lint` | ok: eslint 0 problems, typography lint passed |
| `pnpm typecheck` | ok: all 7 packages |
| `pnpm test` | ok: schemas 9, extension 101, core 128, worker 35, adapters 115, fixtures 282, desktop 106+52 (158), scripts 39, Swift 62. Total 929 automated tests, 0 failures, 0 skipped |
| `pnpm audit --audit-level=high` | No known vulnerabilities found |
| `pnpm test:e2e` | pending |
| `pnpm build` | pending |
| `pnpm package:mac` | pending |
| `pnpm alpha:bundle` | pending |
| `pnpm alpha:smoke` | pending |

## Items blocked by external constraints

| Item | Constraint | Manual step and evidence needed |
|---|---|---|
| Notarization | No APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID in the environment | Export the three variables and run `pnpm package:mac`; evidence: `spctl -a -vv Apprentice.app` prints "accepted" and `xcrun stapler validate` succeeds |
| Cloudflare deployment | No CLOUDFLARE_API_TOKEN / account | Follow services/feedback-worker/README.md; evidence: `GET https://<worker>/health` returns `{ ok: true }` and a test upload appears in the admin summary |
| Screen Recording and Accessibility grants | Interactive TCC prompts cannot be answered in a non-interactive build session | Launch the packaged app, complete onboarding step 4, confirm both badges show "granted" and the Activity view shows a real screenshot thumbnail |
| Real UI-Mate inference | No model weights downloaded (8.6 GB, requires explicit confirmation) | Run `node scripts/install-uimate-model.mjs --yes`, `node scripts/start-local-model.mjs`, then `RUN_LOCAL_MODEL_TEST=1 pnpm test:local-model`; evidence: the test prints a parsed UI-Mate action |

## Independent security and privacy review (2026-09-02)

A read-only review by a separate agent audited the code against `docs/THREAT_MODEL.md` and the
section 20 quality gates. Result: no critical findings; two medium findings, both fixed in the
same day (see below); low findings addressed or documented.

Verified controls (file references in the review): renderer hardening (`electron/window.ts`,
`index.ts` permission/navigation/window-open denial), CSP without `unsafe-eval` and with
`connect-src 'none'`, whitelisted preload surface, Zod validation of every IPC request and
response with sender checks, no `shell: true` or string-built commands anywhere (both `spawn`
call sites use argument arrays), model output gated by schema parse, deterministic validation,
risk classification that never reads model-asserted risk, policy (typing always approve,
external communication never auto, financial/credential unsupported, sensitive abort with
emergency stop, `low_risk_auto` behind the experimental flag), helper emits only modifier
chords and reserves stdout for protocol lines, loopback server bound to 127.0.0.1 with
timing-safe code and token checks, origin binding, 64 KiB body cap and rate limits, extension
without `host_permissions`, `incognito: not_allowed`, no `externally_connectable`, value-free
capture with sensitive pauses, AES-256-GCM with random IVs and tag verification, safeStorage-
protected master key with 0600/0700 files, blob id and symlink checks, realpath-based
path-inside checks, zip-bomb budgets, delete-all scope, remote feedback allowlist enforced on
client and server (server also scans values), free-text-free analytics, no persisted hidden
reasoning, no hardcoded secrets in source or git history, `pnpm audit` clean.

Findings and resolution:

| Severity | Finding | Resolution |
|---|---|---|
| Medium | Headless smoke mode could fall back to a test-only XOR protector against the real data directory when APPRENTICE_DATA_DIR was unset | Smoke and e2e modes now require an isolated APPRENTICE_DATA_DIR and exit before touching storage otherwise |
| Medium | Helper `approvalToken` was format-checked only | Token is now an HMAC-SHA256 over the canonical approved action with a per-spawn secret; the helper refuses actions without a secret or with a mismatching token |
| Low | `app:openExternal` accepted any URL scheme | Restricted to http(s) |
| Low | `disable-library-validation` entitlement widens same-user dylib injection | Documented as residual risk in the threat model |
| Info | LGPL-3.0 (`@img/sharp-libvips-darwin-arm64`) and CC-BY-4.0 (`caniuse-lite`) packages | Build-time transitive dependencies of electron-builder and browserslist; not shipped in the app bundle |
