# Known limitations (alpha)

This list is honest about what the alpha does not do. Items marked "verified gap" were confirmed
during the build; items marked "by design" are intentional alpha scope.

## Platform and distribution

- Apple Silicon and macOS 14+ only (by design). No Intel build, no Windows, no mobile client.
- The build is signed with a Developer ID identity when one is present on the build machine and
  ad hoc otherwise; it is NOT notarized unless notarization credentials were supplied. Gatekeeper
  will warn on first launch; see the alpha guide for the exact steps (verified gap on the build machine: no notarization credentials).
- No automatic updater. Testers install new builds manually.

## Observation

- Only apps and browser domains you allowlist are observed. Apps without a stable bundle id or
  browsers other than Chromium-based ones (Safari, Firefox) get app-level events only, no
  page-level semantics (by design).
- The browser extension needs per-site permission grants from its popup; until granted, browser
  events are not captured for that domain (by design, to avoid an all-sites permission).
- Window titles and page titles are captured (encrypted); if a title itself contains sensitive
  text, it is retained for up to seven days unless you delete it.
- Meeting-end and calendar-boundary signals are inferred only from visible context (titles); there
  is no calendar integration.

## Learning

- Passive candidates need at least two similar episodes with at least three meaningful actions and
  a median active duration above 90 seconds. Very short or very irregular routines are not proposed.
- Similarity is deterministic and structural. Workflows that look alike but differ in intent can be
  grouped together; use "Wrong boundaries" or "Not useful" to correct.
- Variable detection is heuristic (route ids, differing labels). Free-text variables typed into
  fields are never captured, so they cannot be inferred.

## Assisted runs

- Guide and approval-every-step modes only. `low_risk_auto` exists behind an experimental flag,
  is off by default, and covers only read-only actions.
- Supported actions: click, double click, move, scroll, type text, press key, hotkey, wait, ask
  user, done, fail. Drag, triple click, key hold, and any shell or file operation are unsupported
  and rejected.
- Financial, credential, permission, and sensitive-context actions abort as unsupported.
- Verification is deterministic-first (predicates, before/after screen and OCR diff); the model's
  own verification is only supporting evidence. Some subtasks end with a user confirmation.
- Coordinates from the model are mapped through the resize transform and checked against OCR and
  accessibility context; ambiguous or moved targets are refused rather than guessed.
- UI-Mate was trained on Ubuntu screenshots; the provider remaps ctrl to command by default and
  states macOS in the instruction, but macOS-specific behaviour is not guaranteed.

## Model

- Demo mode uses a deterministic mock provider; it does not perform real inference.
- The recommended local route (llama.cpp Q6_K) needs about 8.6 GB of downloads and 24 GB of unified
  memory for comfortable use with an 8192-token context. 16 GB machines should use a smaller
  quantization or an external endpoint.
- Real UI-Mate inference was not exercised on the build machine because the weights were not
  downloaded (they require explicit confirmation); the OpenAI-compatible request path and the
  parser are covered by tests with recorded official responses and by the opt-in smoke test.

## Feedback

- Remote upload requires a deployed Worker; the alpha bundle documents deployment but does not
  include a hosted endpoint. Local export and offline aggregation work without it.
- Pulse prompts on day 1, 3, and 7 rely on the app being opened on those days.

## Not supported in the alpha

- Team collaboration, multiple profiles, payments, purchases, account changes, credential entry,
  unattended destructive actions, autonomous sending of email or messages.
