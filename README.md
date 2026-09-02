# Apprentice

A local-first, self-learning work agent for Apple Silicon macOS (alpha).

Apprentice observes only the applications and browser domains you allow, detects repeated
goal-directed workflows, explains what it believes it learned (evidence, trigger, steps,
variables, confidence, time spent), lets you teach or correct it, and assists one approved action
at a time with deterministic risk gating. All data stays on your Mac, encrypted. The optional local
model (Tencent UI-Mate-9B via llama.cpp or MLX) runs on loopback; demo mode needs no model at all.

- Product docs: [docs/ALPHA_TEST_GUIDE.md](docs/ALPHA_TEST_GUIDE.md), [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md), [docs/PRIVACY_MODEL.md](docs/PRIVACY_MODEL.md)
- Engineering docs: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md), [docs/MODEL_SETUP.md](docs/MODEL_SETUP.md), [docs/BUILD_STATUS.md](docs/BUILD_STATUS.md), [docs/adr/](docs/adr/)
- Project constraints for Claude Code sessions: [CLAUDE.md](CLAUDE.md)

## Repository layout

```
apps/desktop            Electron + React desktop app (main, preload, renderer)
apps/chromium-extension MV3 companion extension (loopback pairing, allowlisted capture)
packages/schemas        Zod contracts for every process boundary; product name constant
packages/core           deterministic engine (normalize, segment, score, risk, crypto, export)
packages/model-adapters mock, OpenAI-compatible, and exact UI-Mate providers
packages/test-fixtures  synthetic scenarios, SVG screens, demo dataset
native/mac-helper       Swift helper: Accessibility, ScreenCaptureKit, CGEvent, Vision OCR
services/feedback-worker Cloudflare Worker + D1 for optional structured feedback
scripts/                bootstrap, model runtime, alpha bundle, aggregator, smoke test
fixtures/               generated screenshots and scenario JSON
docs/                   documentation and ADRs
dist/alpha/             shareable alpha bundle (generated)
```

## Build from source

Requirements: Apple Silicon, macOS 14+, Node 22.12+ (24 recommended), pnpm 10, Xcode Command Line
Tools with Swift 6.

```bash
pnpm install
node scripts/build-helper.mjs        # Swift helper -> apps/desktop/resources/helper
pnpm lint
pnpm typecheck
pnpm test                            # unit + integration + worker + scripts + swift
pnpm build                           # packages, extension, renderer, main, preload
pnpm test:e2e                        # Playwright demo-mode journey (Electron)
pnpm package:mac                     # arm64 .dmg and .zip (Developer ID if present, else ad hoc)
pnpm alpha:bundle                    # dist/alpha/
pnpm alpha:smoke                     # verifies the bundle without downloading a model
```

Development: `pnpm --filter @apprentice/desktop dev` (electron-vite with hot reload).

Optional local model: see [docs/MODEL_SETUP.md](docs/MODEL_SETUP.md). Real-model smoke test:
`RUN_LOCAL_MODEL_TEST=1 pnpm test:local-model`.

## Privacy invariants

Allowlist first; no keystroke or secure-field recording; sparse encrypted screenshots; no cloud
model in the default path; no upload without explicit consent and a payload preview; model output
never triggers an OS action without deterministic validation, risk classification, and approval.
Details in [docs/PRIVACY_MODEL.md](docs/PRIVACY_MODEL.md).

## License

Source in this repository: Apache-2.0. Third-party notices: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
