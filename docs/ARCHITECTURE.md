# Architecture

Apprentice is a pnpm monorepo with one Electron desktop app, one native Swift helper, one
Chromium extension, one optional Cloudflare Worker, and four TypeScript packages.

```
+------------------------------------------------------------------------------------+
| Electron main process (apps/desktop/src/main)                                      |
|  storage (node:sqlite, AES-256-GCM blobs)   observation pipeline   run engine      |
|  helper bridge (JSONL)   loopback server (127.0.0.1)   model manager   retention   |
|  IPC registry: every channel validated against packages/schemas ipcContract        |
+-----------^---------------------^----------------------^---------------------------+
            | JSON Lines          | HTTP loopback         | contextBridge (preload)
+-----------+-----------+  +------+------------+  +-------+------------------------+
| native/mac-helper     |  | chromium-extension|  | renderer (React, sandboxed)     |
| AX, SCK, CGEvent, OCR |  | MV3, allowlisted  |  | no Node, strict CSP            |
+-----------------------+  +-------------------+  +--------------------------------+
            model boundary: packages/model-adapters (mock | openai_compatible | uimate)
            deterministic engine: packages/core  (normalize, segment, score, risk, crypto)
```

## Packages

| Package | Role |
|---|---|
| `packages/schemas` | Zod schemas and inferred types for every cross-process contract. Product identity lives in `branding.ts`. |
| `packages/core` | Deterministic engine with no Electron dependency: tokens, redaction, allowlist, sensitive-context detection, perceptual hashing, capture throttling, backpressure, episode segmentation, similarity, candidate scoring, skill drafting and versioning, risk engine and policy, action validation and coordinate mapping, completion predicates, retention plans, safe zip, remote payload sanitizer, metrics. |
| `packages/model-adapters` | `VisionAgentProvider` implementations. The UI-Mate port is byte-compatible with the official prompt and parser and runs in demonstration-guided mode. |
| `packages/test-fixtures` | Synthetic scenarios (post-meeting follow-up, invoice processing, candidate review), SVG screen templates rendered to PNG, demo dataset generator, demo skill templates and mock run scripts. |

## Data flow

1. Observation. The helper streams events (app changes, window titles, mouse downs, modifier chords,
   clipboard counter, idle, secure fields). The extension posts browser events for allowlisted
   domains. The main process classifies each event against the allowlist before deciding whether
   a screenshot may be captured (`classifyContext`); outside the allowlist only a `privacy_gap`
   marker is stored.
2. Capture. `CaptureThrottle` enforces one capture per 5 s outside a run; `desktopCapturer`
   captures the display and crops to the frontmost window; the perceptual hash drops near
   duplicates; the PNG is encrypted into `screenshots/<id>.enc`; OCR runs through the helper and is
   stored encrypted.
3. Segmentation and discovery. Events become normalized tokens, then episodes (teach markers, idle
   gaps, outcome events, context shifts). Closing actions within 20 s of an outcome (cmd+w, cmd+q,
   escape, app switch, idle, clipboard, screenshot, privacy gap) stay in the finished episode, and
   tiny post-outcome fragments fold back into it. `discoverCandidates` clusters similar episodes into
   `WorkflowCandidate`s with component scores and a plain-language confidence explanation.
4. Teaching. "Learn what I just did" opens the last 15 minutes, lets the user trim and exclude, then
   `draftSkillFromEvents` produces a deterministic draft; a generic provider may refine it. The
   retention preview lists exactly what is kept.
5. Assisted run. For each step: capture, propose (provider), parse into `ProposedAction`, validate
   (bounds, stale screen, target resolution), classify risk, decide policy, ask for approval,
   execute through the helper with an approval token, verify deterministically (predicates,
   before/after hash and OCR diff), advance subtasks. Escape or the menu bar stops immediately.
6. Feedback. Structured answers are stored locally, exportable as a sanitized bundle, optionally
   uploaded (after preview) to the Worker, and aggregated offline by `scripts/aggregate-feedback.mjs`.

## Security boundaries

- Renderer: `contextIsolation`, `sandbox`, no Node, CSP `connect-src 'none'`, preload exposes only
  channel names in the contract. Main validates request and response for every channel.
- Helper: refuses actions without an approval token and while the emergency stop is set; never emits
  plain keystrokes or secure field contents.
- Loopback: bound to 127.0.0.1, pairing code, hashed bearer token, origin check, rate limits.
- Model: never sees the OS; only proposes. The risk engine and user approval are authoritative.

See `docs/adr/` for the decisions behind the capture path, SQLite driver, pairing, and model boundary.
