# Privacy model

Apprentice is local-first. This document states exactly what is captured, where it lives, how
long it stays, and what can leave the Mac.

## What stays on the Mac (always)

| Data | Captured when | Stored as | Default retention |
|---|---|---|---|
| Structured interaction events (app activated, window changed, click with semantic descriptor, form submitted, shortcut chord, download, copy/paste occurrence, idle state) | Only while Learning is on and the frontmost app or browser domain is on your allowlist | SQLite rows; redacted and normalized | 30 days or until you delete them |
| Window and page titles | Same conditions | Encrypted payload column (AES-256-GCM) | 7 days |
| Sparse screenshots | On meaningful transitions in allowed context, at most one every 5 seconds, deduplicated | Encrypted files under Application Support | 24 hours after analysis |
| OCR text of those screenshots | When a screenshot is analyzed locally | Encrypted rows | 7 days |
| Episodes, candidates, skills, run traces | Derived locally | SQLite rows (run traces redact typed text) | 30 days (skills until you delete them) |
| Structured feedback and product analytics events | When you submit feedback or use the product | SQLite rows | Until exported, uploaded, or deleted |
| Master key | First launch | macOS Keychain via Electron safeStorage | Until Delete all |

## What is never captured

- Ordinary keystrokes or typed characters. The helper only reports modifier chords (for example
  cmd+shift+p) and never plain keys.
- Contents of password or secure fields; focusing one pauses capture.
- Clipboard contents; only the change counter is observed.
- Field values in web forms; only the label and value length.
- Anything in apps or domains you have not enabled, in Private mode, while Paused, or in
  incognito/private windows. Focus outside the allowlist yields a `privacy_gap` marker only.
- Password managers, banking, payment, health portals, and system authentication dialogs are
  always denied, even if added to the allowlist.
- Continuous video.

## What can leave the Mac (only with explicit opt-in)

Remote structured feedback is off by default. If you enable it, the exact payload is shown before
each upload. It may contain only:

- A pseudonymous installation id, optional participant code, app version, macOS major version,
  chip family, memory bucket, model provider and model name.
- Product event names with numeric counts and timings and a risk class.
- Your structured feedback selections (yes/no/ratings/reason codes).
- A free-text comment, only after a warning, and only if you wrote one.

It never contains screenshots, OCR, URLs, domains, window or page titles, names, emails,
messages, document content, filenames, clipboard content, typed text, or model prompts and
responses. The schema is enforced with an allowlist on the client (`RemoteFeedbackPayloadSchema`)
and on the server. See `docs/THREAT_MODEL.md` threat 9.

Model inference is local by default (demo mode uses no model at all). If you configure a remote
OpenAI-compatible endpoint yourself, redacted event summaries and up to two screenshots per
analysis, plus per-step screenshots during a guided run, are sent to that endpoint. The app labels
such a provider as "remote" in the model manager.

## Your controls

- Allowlist: add or remove apps and domains at any time (Privacy and Settings).
- Pause for 15 minutes, Pause until resumed, Private mode: from the menu bar and the header.
- Retention sliders with shorter maxima than the defaults.
- Delete today, Delete selected workflow, Delete all local data (removes encrypted files, database
  rows, model caches created by the app, queued uploads; shared model weights need a separate
  confirmation).
- Export a sanitized feedback bundle; screenshots are included only if you select and preview each.
- Before saving a taught skill and before exporting diagnostics, the app lists exactly what will be
  retained or written.

## Where data lives

`~/Library/Application Support/Apprentice/`

```
apprentice.sqlite      database (WAL mode)
screenshots/           *.enc encrypted screenshots
keys/                  master.key.enc, model_api_key.secret.enc (safeStorage-protected)
exports/               feedback bundles and diagnostics you export
logs/                  app and model-server logs (no content, no secrets)
runtime/               llama.cpp release (optional)
models/                UI-Mate weights (optional, large)
model-caches/          caches created by the app for the model (deleted by Delete all)
```
