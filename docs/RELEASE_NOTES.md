# Release notes: Apprentice 0.1.0-alpha.1

First shareable alpha. Apple Silicon, macOS 14+, arm64 only.

## What is in this build

- Onboarding with local-first explanation, hardware check, empty-by-default allowlist,
  live permission status, four model setup paths, separate feedback consent, and menu-bar status.
- Passive Learning mode with allowlist-first capture, privacy gaps, secure-field pauses, sparse
  encrypted screenshots (max one per 5 s, perceptual dedup), local OCR.
- "Learn what I just did" (Option+Command+L) with range trimming, step exclusion, retention
  preview, and a versioned skill editor.
- Deterministic routine detection: episode segmentation, weighted sequence similarity, transparent
  candidate scores with plain-language confidence explanations, consumption suppression.
- Assisted runs in guide and approval-every-step modes with strict action schema, coordinate
  safety, stale-screen refusal, deterministic risk engine and policy, annotated approvals, Escape
  to stop, deterministic verification.
- Model boundary with a mock provider (demo mode), a generic OpenAI-compatible provider, and an
  exact UI-Mate port (official prompt, parser, history collapsing, demonstration-guided workflow).
- Local model manager: pinned llama.cpp b10752 runtime and UI-Mate-9B Q6_K with checksum-verified,
  resumable downloads, loopback-only server on a dynamic port, start/stop/restart, logs.
- Chromium MV3 companion extension paired over 127.0.0.1 with per-site permission grants.
- Structured feedback (candidate, run, pulse), sanitized export bundle, offline aggregator, and an
  optional Cloudflare Worker with a strict allowlist schema.
- Privacy controls: retention sliders, Delete today, Delete selected workflow, Delete all.
- Demo mode with three synthetic workflows and SVG-rendered screens.

## Signing and notarization

See `docs/BUILD_STATUS.md` for the exact signing state of this build. Unless it says notarized,
expect the Gatekeeper "Open Anyway" step described in the alpha guide.

## Known limitations

See `KNOWN_LIMITATIONS.md` in this bundle.
