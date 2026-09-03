# Contributing

Thanks for looking. Apprentice is an alpha with a small surface that has to stay trustworthy, so
the bar for changes is "tested and explained", not "big".

## Ground rules

1. **Privacy invariants are not negotiable.** Allowlist first, no keystroke or secure-field
   capture, sparse encrypted screenshots, no cloud model in the default path, model output never
   reaches the OS without validation, risk gating and approval. See
   [docs/PRIVACY_MODEL.md](docs/PRIVACY_MODEL.md). A PR that weakens one of these will be closed.
2. **Tests first.** Every behaviour change ships with a failing test that the change makes pass.
   `pnpm test` runs unit, integration, worker, script and Swift suites (about 1,000 tests, a
   couple of minutes on Apple Silicon).
3. **No fake success.** If something only works with the mock provider, say so in the PR and in
   `docs/KNOWN_LIMITATIONS.md`. Measured numbers go in `docs/MODEL_PERFORMANCE.md` with the
   machine they came from.
4. **Small files, immutable data, explicit errors.** Under 800 lines per file, spread instead of
   mutate, handle every error at the boundary. ASCII punctuation only (the typography lint fails
   on em dashes and smart quotes).
5. **Parameter arrays for every spawned process.** Never build a shell string.

## Getting set up

Apple Silicon, macOS 14+, Node 22.12+ (24 recommended), pnpm 10, Xcode Command Line Tools with
Swift 6.

```bash
pnpm install
node scripts/build-helper.mjs
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @apprentice/desktop dev     # electron-vite with hot reload, demo mode works without a model
```

Optional real model: [docs/MODEL_SETUP.md](docs/MODEL_SETUP.md) (8.6 GB download, explicit consent).

## Where things live

| Area | Path | Notes |
|---|---|---|
| Cross-process contracts | `packages/schemas` | Zod schemas; types are inferred, never duplicated |
| Deterministic engine | `packages/core` | normalization, segmentation, scoring, risk, crypto, export |
| Model providers | `packages/model-adapters` | mock, OpenAI-compatible, exact UI-Mate port |
| Desktop app | `apps/desktop` | Electron main owns everything; renderer has no Node access |
| Native helper | `native/mac-helper` | Swift, JSON Lines on stdin/stdout, HMAC approval tokens |
| Browser companion | `apps/chromium-extension` | MV3, loopback only, pairing token |
| Feedback worker | `services/feedback-worker` | Cloudflare Worker + D1, strict allowlist schema |

Architecture decisions are recorded in [docs/adr/](docs/adr/). Add one when you change a boundary.

## Pull requests

- One purpose per PR. Cleanups go in their own PR.
- Conventional commit titles: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `perf:`, `ci:`.
- Fill in what you ran. "CI is green" is necessary, not sufficient: for anything touching capture,
  runs, or the helper, say what you exercised on a real Mac.
