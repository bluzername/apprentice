# Desktop end-to-end tests

Playwright drives the built Electron app through the full demo journey in
`demo-journey.spec.ts`: onboarding (all seven steps), candidates, saving a
skill, a guided run with per-step approvals, structured feedback, bundle export
plus `scripts/aggregate-feedback.mjs`, and "Delete today" on the Privacy page.
It mirrors the headless smoke test in `src/main/headless/smoke.ts`, but through
the real UI.

## Run

```bash
pnpm test:e2e                                   # from the repo root
pnpm --filter @apprentice/desktop run test:e2e  # same thing
```

The spec builds `apps/desktop/out/` with `electron-vite build` when it is
missing. Rebuild manually after changing main, preload or renderer code:

```bash
pnpm --filter @apprentice/desktop exec electron-vite build
```

Artifacts land in `apps/desktop/test-results/` (one PNG per step, plus a trace
on failure) and `apps/desktop/playwright-report/`.

## The `--e2e` launch mode

The app is started as `electron out/main/index.js --e2e` with
`APPRENTICE_E2E=1` and `APPRENTICE_DATA_DIR` pointing at a fresh temp
directory. In this mode (`src/main/headless/mode.ts`, `src/main/electron/boot.ts`):

- windows are shown and the renderer is the real one, so selectors match what
  users see;
- the screen source is the fixture source and the helper is the in-process fake
  helper, so no Screen Recording or Accessibility permission is needed;
- the permission system reports everything as granted;
- the mock model provider is used once Demo mode is chosen during onboarding;
- all state (SQLite, screenshots, keys, exports) lives under the temp data
  directory, which is removed at the end of the run.

No macOS permission prompts appear and nothing is written outside the temp
directory, apart from Playwright's own artifacts. Exporting the bundle asks the
shell to reveal the file, so Finder may come to the front briefly.

## Notes

- The test is one serial spec with `test.step` blocks; it waits on UI state
  (headings, toasts, badges) rather than sleeps.
- The guided run loop approves each step once and answers any question the
  run asks. It is bounded to 40 iterations.
- If another Apprentice instance holds the single-instance lock, the app under
  test quits immediately. Close the other instance first.
