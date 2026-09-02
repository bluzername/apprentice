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
