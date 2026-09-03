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
| packages/schemas | verified | `pnpm --filter @apprentice/schemas test`: 12 tests pass; typecheck clean |
| native/mac-helper | verified | `swift build -c release --arch arm64` clean; `swift test`: 79 tests pass (incl. HMAC approval token and canonical JSON parity vectors); `--self-test` ok; live SCK capture (3408x2160) and OCR (70 blocks) exercised |
| services/feedback-worker | verified | 35 tests pass under vitest-pool-workers; `wrangler deploy --dry-run` succeeds offline |
| apps/desktop storage layer | verified | `vitest run test/storage.test.ts`: 10 tests pass (node:sqlite, encryption at rest, key store) |
| packages/core | verified | `pnpm --filter @apprentice/core test`: 19 files, 128 tests pass; typecheck and eslint clean |
| packages/model-adapters | verified | 11 files, 115 tests pass incl. golden parity with official UI-Mate trajectory (12 steps) and byte-equal prompts; typecheck and eslint clean; local-model smoke test skipped by design when RUN_LOCAL_MODEL_TEST is unset |
| packages/test-fixtures | verified | 6 files, 282 tests pass; 26 fixture files rendered (1.05 MB) |
| apps/chromium-extension | verified | 17 files, 101 tests pass; `vite build` produces MV3 dist and `apprentice-extension.zip` (119 KB) |
| apps/desktop main process | verified | `vitest run`: 13 integration files, 67 tests pass (real helper binary in fixture mode, loopback pairing, discovery, teach, run engine, feedback export + aggregator, privacy delete-all, runtime manager with fake llama-server, headless `--smoke-test` through the built app printing ok:true with 3 candidates and a 13-step completed run) |
| apps/desktop renderer | verified | 7 files, 60 tests pass; tsc web config clean; electron-vite build succeeds; UI exercised manually in a browser against the dev mock (light and dark) |
| scripts (runtime, model, bundle) | verified | `pnpm test:scripts`: 7 files, 39 tests pass; real llama.cpp b10752 download, sha256, extraction, and `--version` verified on this machine |
| e2e (Playwright, demo mode) | verified | `pnpm test:e2e`: 1 passed (about 13 s): onboarding 7 steps, demo load, candidate detail, edit and save skill (v1 then v2 with correction), guided run with 9 approvals and 4 subtask confirmations to Completed, run feedback, bundle export + offline aggregation, Delete today |
| packaging (dmg, zip) | verified | unpacked ad hoc build verified: `electron-builder --mac --arm64 --dir` produces Apprentice.app (283 MB) with only zod/yazl/yauzl in the asar, helper and fixtures under Contents/Resources, ad hoc signature with runtime flag (`Signature=adhoc`), and the packaged binary passes `--smoke-test` (3 candidates, 13-step completed run, bundle exported) |
| dist/alpha bundle | verified | `pnpm alpha:bundle` writes dist/alpha with Apprentice-0.1.0-alpha.1-arm64.dmg (120,101,153 bytes), Apprentice-0.1.0-alpha.1-arm64-mac.zip (119,569,394 bytes), apprentice-extension.zip (119,629 bytes), ALPHA_TEST_GUIDE.md, KNOWN_LIMITATIONS.md, PRIVACY_SUMMARY.md, RELEASE_NOTES.md, MODEL_SETUP.md, THIRD_PARTY_NOTICES.md, EXTENSION_INSTALL.md, SHA256SUMS.txt, manifest.json |

## Top-level commands

| Command | Result (2026-09-02) |
|---|---|
| `pnpm install` | ok (pnpm 10.33.0, 8 workspace projects) |
| `pnpm lint` | ok: eslint 0 problems, typography lint passed |
| `pnpm typecheck` | ok: all 7 packages |
| `pnpm test` | ok (2026-09-03, after real-model validation): schemas 14, extension 101, core 164, worker 35, adapters 116, fixtures 282, desktop 181, scripts 40, Swift 97. Total 1030 automated tests, 0 failures, 0 skipped (the only intentional skips are the opt-in real-model test and benchmark under their own configs) |
| `pnpm test:local-model` | ok against the real managed llama-server (UI-Mate-9B Q6_K): one parsed action, 12 s |
| `pnpm bench:local-model` | ok: latency, token and memory benchmark against the real server (`packages/model-adapters/bench`, see docs/MODEL_PERFORMANCE.md) |
| `pnpm audit --audit-level=high` | No known vulnerabilities found |
| `pnpm test:e2e` | ok: 1 passed (demo journey) |
| `pnpm build` | ok: schemas, core, adapters typecheck; fixtures rendered; extension dist + zip; worker dry-run bundle (833 KiB); electron-vite main/preload/renderer |
| `pnpm package:mac` | ok: signed with the Developer ID Application identity found in the keychain (hardened runtime, entitlements), NOT notarized (no credentials); dmg and zip for arm64 |
| `pnpm alpha:bundle` | ok: dist/alpha/ (see component table) |
| `pnpm alpha:smoke` | ok: documents present, SHA-256 checksums verified, extension MV3 without incognito, `codesign --verify --deep --strict` valid, Gatekeeper assessment not accepted (unnotarized, expected), arm64 binary, helper `--self-test` ok, packaged app `--smoke-test` ok (3 candidates, 13-step completed run, bundle exported) |

## Items blocked by external constraints

| Item | Constraint | Manual step and evidence needed |
|---|---|---|
| Notarization | No APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID in the environment | Export the three variables and run `pnpm package:mac`; evidence: `spctl -a -vv Apprentice.app` prints "accepted" and `xcrun stapler validate` succeeds |
| Cloudflare deployment | No CLOUDFLARE_API_TOKEN / account | Follow services/feedback-worker/README.md; evidence: `GET https://<worker>/health` returns `{ ok: true }` and a test upload appears in the admin summary |
| Screen Recording and Accessibility grants | Interactive TCC prompts cannot be answered in a non-interactive build session | Launch the packaged app, complete onboarding step 4, confirm both badges show "granted" and the Activity view shows a real screenshot thumbnail |
| Real UI-Mate inference | Verified on 2026-09-03 (see "Real model on the build machine" below); the row is kept for other machines | Run `node scripts/install-uimate-model.mjs --yes`, `node scripts/start-local-model.mjs`, then `RUN_LOCAL_MODEL_TEST=1 pnpm test:local-model`; evidence: the test prints a parsed UI-Mate action |

## Signing state of this build

Signed with "Developer ID Application" (team P763LRL2BT) because that identity exists in the
build machine keychain; `scripts/package-mac.mjs` falls back to ad hoc signing (verified with
`CSC_IDENTITY_AUTO_DISCOVERY=false`, `Signature=adhoc` with the runtime flag) when no identity is
present. The build is NOT notarized and NOT stapled; `spctl -a -vv` rejects it, so testers must use
the "Open Anyway" step in the alpha guide. Headless smoke and e2e modes never touch the Keychain
(they use an isolated data directory and a test-only protector); a Developer ID-signed build that
reused an existing "Apprentice Safe Storage" Keychain item created by a differently signed build
blocked on a Keychain access prompt before this change, which is why the rule exists.

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

## Independent UX and accessibility review (2026-09-02)

A separate read-only review of the renderer (84 files, contrast computed from the token file)
rated the UI as partially conforming to WCAG 2.2 AA before fixes: 3 high findings (dark-mode
Stop button contrast 2.39:1, toast/approval live regions inserted with their first message,
focus dropped to body when a busy button became disabled), 12 medium (status chip menu
semantics and focus return, Escape stopping a run while dismissing a menu, table rows as
tab stops without a role, input border contrast, small chip targets, no title or focus change on
route change, title-only explanations on disabled buttons, onboarding consent not persisted on
Continue, no confirmation for "Never learn this pattern", failed status calls shown as
"Stopped", typed text hiding line breaks, de-emphasised teach rows below 4.5:1), and 11 low.
All high and medium findings and the quick low findings were applied afterwards (see the git
log entry "a11y: apply UX review fixes"). Confirmed strengths: complete light and dark tokens,
muted text >= 6.8:1, reduced motion honoured, labelled fields with described errors, native
dialog with focus trap and restore, keyboard range slider with value text, decorative icons with
named icon-only buttons, real empty/loading/error states on every page, evidence-first candidate
language, exact action and typed text in the approval panel, typed-phrase delete-all.

## Live alpha test on the build machine (2026-09-03)

Real, non-simulated verification with the packaged app installed in /Applications and launched
from the build session (which inherits the session's Screen Recording and Accessibility grants).

Verified:
- Onboarding completed against real hardware data; both permissions reported Granted; helper
  connected; loopback listening on 47815; Learning on.
- Real observation: 144 events (app activations, encrypted window titles, clicks enriched with
  accessibility role and name, cmd chords), 51 encrypted screenshots with Vision OCR, privacy gaps
  for non-allowlisted apps (Apprentice itself, Notes, the Claude desktop app).
- Passive discovery on a real routine (Finder open PDF -> Preview -> cmd+W -> TextEdit ledger ->
  cmd+S -> cmd+W), performed at a human pace: one candidate "Observed 2 times", confidence 0.70,
  sequence similarity 0.86, median duration 3 min, one detected variable, risk internal change,
  evidence linked to two episodes. Two faster occurrences (44 s and 74 s) were correctly NOT
  proposed because the spec requires a median active duration above 90 s.
- Candidate -> "Edit and save" -> skill v1 (3 subtasks, guide mode).
- "Learn what I just did" via the global shortcut from Finder: range editor with 36 events and
  16 screenshots, retention preview, deterministic draft with 8 subtasks, saved as a taught skill.
- Menu bar: Pause for 15 minutes and Enter Private mode both produced zero events and zero
  screenshots during real Finder clicks; Resume restored Learning; status line reflects state.
- Feedback: general feedback stored locally; export bundle written (4 files, 136 product events,
  no titles, URLs, OCR, or screenshots) and aggregated offline by scripts/aggregate-feedback.mjs.
- Privacy page: 18 MB stored, counts consistent with the database.

Bugs found by the live test and fixed the same day: fractional helper timestamps dropping event
batches; startup exception hanging in a modal; Chrome profile and performance suffixes in
titles; Finder rows resolving to the window title; double clicks stored twice; closing actions
splitting episodes after a save; teach shortcut recorded as the last taught step; screenshots
not linked to their events in Activity; guided runs aborting because the dashboard is frontmost
when a run starts (see the run-engine target-app activation change).

Guided run, re-tested after the target-app activation change: started from the dashboard, the
engine activated Finder itself, captured the real Finder window, the mock proposed a click, the
approval panel opened with the annotated target and a Navigation risk badge, approval executed a
real click through the helper (display point 956,513, 55 ms) with validation resolved via
Accessibility, verification passed via screen and OCR diff, subtask completion asked for user
confirmation (no deterministic predicate on a candidate-derived skill), subtask 2 switched to
Preview and executed a second approved click. Subtask 3 exposed a safety gap: the target app had
no window, the capture fell back to the display, and the proposal pointed at Apprentice's own
window; it was rejected by the user and the engine now refuses that case (see the target-window
guard change). Run feedback and the Runs trace (validation, approval, execution, verification,
timing) were verified. Diagnostics preview truncation bug (4002 characters) found and fixed.

Final guided run after the guard change, with a TextEdit window open: status "completed",
6 steps, 3 approved clicks executed through the helper (Finder 956,513; Preview 618,567;
TextEdit 513,295; 42 to 60 ms each), each verified via screen and OCR diff, 3 subtask
completions confirmed by the user, summary "All subtasks verified". Teach draft re-check on the
new build: the shortcut artifact is gone ("Work in finder, preview, textedit" fallback name).
Activity and teach lists render blurred screenshot thumbnails.

Not verified live at that point: the browser extension (needs a manual unpacked install). Real
UI-Mate inference followed the same afternoon (next section).

## Real model on the build machine (2026-09-03)

Everything in this section ran on the same M3 Max (36 GB) with the packaged app from
/Applications, the pinned llama.cpp b10752 runtime and UI-Mate-9B Q6_K weights, both installed
and hash-verified by the repository scripts (8.62 GB downloaded in about 16 minutes). Numbers
are in `docs/MODEL_PERFORMANCE.md`; this is the pass/fail record.

Verified:
- `node scripts/install-local-runtime.mjs` and `node scripts/install-uimate-model.mjs --yes`
  installed and verified the runtime and weights; `--check --verify` re-hashed both files.
- `node scripts/start-local-model.mjs --port 8000 --ctx N` served the model; healthy in 2-7 s.
- `RUN_LOCAL_MODEL_TEST=1 pnpm test:local-model` passed against the real server (one parsed
  UI-Mate action for a synthetic screenshot, 12 s).
- `pnpm bench:local-model` (new) measured latency, tokens and memory for real screenshots at
  three context sizes and three history depths (tables in the performance document).
- In-app managed runtime: Settings > Model > Start spawned llama-server with the manifest
  arguments, health turned green, and after the fixes below the runtime auto-starts 4 s after
  launch and is healthy 7 s after launch.
- Six guided runs with the real model against real Finder, Preview and TextEdit windows: seven
  approved actions executed through the helper (clicks 55-58 ms, double-clicks 145-162 ms, a
  Command+W 25 ms, an Escape 14 ms), every one verified via screen and OCR diff; the model
  clicked the "Today at 12:52" cell the subtask named, double-clicked download-3.pdf so that it
  really opened in Preview, and closed it with Command+W. Rejections ended runs as
  user_rejected, and a proposal aimed at a foreign permission dialog was refused as
  invalid_action by the hit-test guard. No run completed all subtasks: the model never emitted
  subtask_complete and moved on to the next subtask's action instead (documented in
  docs/MODEL_PERFORMANCE.md as the next thing to fix).

Defects found by real-model validation and fixed in this build, each with a regression test:
1. The pinned 8192-token context overflowed on the second full-screen Retina screenshot of a
   subtask (HTTP 400 from llama-server). Context is now 32768.
2. The managed runtime sent up to 5 screenshots per request instead of the manifest's limit
   (`imagesToKeep` was undefined for the managed path); the limit is now taken from the manifest.
3. Keeping only 2 screenshots invalidated llama-server's prefix cache on every step after the
   second, doubling prompt processing; `imagesToKeep` is 8 and the model image is capped at
   1920 px on the long edge so eight screenshots fit.
4. Settings > Model > Start left the provider on "mock": only onboarding ever switched to the
   UI-Mate provider. Starting or restarting the managed runtime now adopts it.
5. Every real proposal was rejected as a stale screen because the 5 s screenshot age limit is
   shorter than one inference (10-20 s). Age now only counts when no fresh capture can be
   compared; unchanged content is not stale.
6. The Escape emergency-stop shortcut both swallowed the helper's approved Escape keypress and
   interrupted the run as "user pressed Escape". The shortcut is lifted around a synthetic
   Escape and an echo guard ignores an Escape stop within 1.5 s of one the run executed.
7. The managed runtime did not start with the app, and the header pill stayed on
   "Model unavailable" after the model became healthy (nothing refreshed the learning status on
   health changes). Both fixed.
8. One reply ran to about 1,300 tokens of thinking (70 s). The managed runtime now caps replies
   at 2048 tokens (manifest `maxTokens`).
9. During a subtask the engine dragged the subtask's app back in front before every capture, so
   after the model opened Preview from Finder it only ever saw Finder again and re-proposed the
   same double-click. Within a subtask the target now follows the frontmost allowed app; the
   subtask's app is activated once when the subtask starts.
10. The approval card drew the target marker offset from the click point when the screenshot
    was centered in its box (container-relative instead of image-relative position).

Observed but not changed:
- A macOS permission dialog belonging to another app ("Allow Granola to find devices on local
  networks?") sat over the Finder window; the display-crop capture includes it and the model
  proposed clicking "Don't Allow" on it every time. The test moved the target windows away from
  the dialog instead of touching a system prompt. A window-only capture (ScreenCaptureKit by
  window) would remove the overlap; see KNOWN_LIMITATIONS.
- The first proposal of a run is sometimes rejected as stale because the target window is
  captured while it is still repainting from inactive to active appearance; the engine retries
  and the second proposal goes through.
- Per-step latency with a real model is 10-18 s of inference plus the time the user takes to
  approve; the mock provider hid this entirely.
