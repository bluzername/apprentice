# Apprentice - Claude Code project notes

Apprentice is a local-first, self-learning work agent for Apple Silicon macOS (alpha).
It observes allowlisted apps and browser domains, detects repeated workflows, explains
what it learned, and assists one approved action at a time. The product name is a
single constant in `packages/schemas/src/branding.ts`.

## Architecture (monorepo, pnpm workspaces, TypeScript strict)

- `packages/schemas` - Zod schemas for every cross-process contract (events, episodes,
  candidates, skills, runs, feedback, helper JSONL protocol, extension loopback protocol,
  model boundary, settings, renderer IPC). Types are inferred from schemas, never duplicated.
- `packages/core` - deterministic engine: normalization, redaction, allowlist, sensitive
  context, episode segmentation, similarity, candidate scoring, risk engine, coordinate
  transforms, perceptual hashing, AES-256-GCM crypto, retention, safe zip export.
- `packages/model-adapters` - replaceable `VisionAgentProvider` implementations: mock,
  OpenAI-compatible generic multimodal, and an exact UI-Mate port (prompt, parser, history
  collapsing, control tokens) vendored from Tencent/UI-Mate at a pinned commit.
- `packages/test-fixtures` - synthetic episodes and SVG-rendered screenshots for demo mode.
- `native/mac-helper` - Swift package CLI (`apprentice-helper`) speaking JSON Lines on
  stdin/stdout, logs on stderr. AX, ScreenCaptureKit, CGEvent, Vision OCR, fixture-stream mode.
- `apps/desktop` - Electron 42 + React + Vite (electron-vite). Main owns SQLite, crypto,
  helper bridge, loopback pairing server, run engine, model manager. Preload exposes only the
  typed IPC contract. Renderer has no Node access.
- `apps/chromium-extension` - MV3 extension talking only to 127.0.0.1 with a pairing token.
- `services/feedback-worker` - Cloudflare Worker + D1 with strict allowlist schema, tested locally.
- `scripts/` - bootstrap, local runtime/model install, alpha bundle, aggregator, smoke test.

## Privacy invariants (do not break)

1. Allowlist first: nothing is captured for apps/domains the user did not enable. Focus
   outside the allowlist emits a `privacy_gap` event only.
2. Never record ordinary keystrokes, secure-field contents, clipboard contents, or field values.
3. Screenshots are sparse (max one per 5 s outside a run), deduplicated by perceptual hash,
   encrypted with AES-256-GCM under a safeStorage-protected master key.
4. No cloud model in the default path. Remote feedback is off by default, allowlist-only,
   previewed before upload, and never contains screenshots, OCR, URLs, titles, or free text
   other than a user-warned comment.
5. Model output never triggers an OS action directly: parse -> schema -> deterministic
   validation -> risk engine -> policy -> user approval -> helper with approval token.
6. Hidden model reasoning is never persisted or displayed.

## Commands

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test          # unit + integration + worker + swift
pnpm test:e2e      # Playwright Electron demo-mode journey
pnpm build         # all packages, helper, extension, renderer
pnpm package:mac   # arm64 dmg + zip via electron-builder
pnpm alpha:bundle  # dist/alpha/
pnpm alpha:smoke   # scripts/smoke-test-alpha.sh
RUN_LOCAL_MODEL_TEST=1 pnpm test:local-model   # opt-in real endpoint smoke test
```

## Definition of Done

See section 20 of `self_learning_work_agent_claude_code_master_prompt.md` and
`docs/BUILD_STATUS.md` (tested facts only). Do not mark items done without running them.

## Conventions

- No em dashes anywhere. Use `-`.
- Immutable data patterns, small files (<800 lines), explicit error handling.
- Parameter-array process spawning only. Never interpolate shell strings.
- Never commit secrets. Never push without explicit permission.
