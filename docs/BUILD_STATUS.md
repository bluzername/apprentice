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
| packages/core | pending | |
| packages/model-adapters | pending | |
| packages/test-fixtures | pending | |
| apps/chromium-extension | pending | |
| apps/desktop main process | pending | |
| apps/desktop renderer | pending | |
| scripts (runtime, model, bundle) | pending | |
| e2e (Playwright, demo mode) | pending | |
| packaging (dmg, zip) | pending | |
| dist/alpha bundle | pending | |

## Items blocked by external constraints

| Item | Constraint | Manual step and evidence needed |
|---|---|---|
| Notarization | No APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID in the environment | Export the three variables and run `pnpm package:mac`; evidence: `spctl -a -vv Apprentice.app` prints "accepted" and `xcrun stapler validate` succeeds |
| Cloudflare deployment | No CLOUDFLARE_API_TOKEN / account | Follow services/feedback-worker/README.md; evidence: `GET https://<worker>/health` returns `{ ok: true }` and a test upload appears in the admin summary |
| Screen Recording and Accessibility grants | Interactive TCC prompts cannot be answered in a non-interactive build session | Launch the packaged app, complete onboarding step 4, confirm both badges show "granted" and the Activity view shows a real screenshot thumbnail |
| Real UI-Mate inference | No model weights downloaded (8.6 GB, requires explicit confirmation) | Run `node scripts/install-uimate-model.mjs --yes`, `node scripts/start-local-model.mjs`, then `RUN_LOCAL_MODEL_TEST=1 pnpm test:local-model`; evidence: the test prints a parsed UI-Mate action |
