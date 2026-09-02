# Threat model

Apprentice observes selected work activity, stores it encrypted on the Mac, and performs
approved GUI actions. This document lists the threats we designed against, the controls in the
alpha, and the residual risk. Controls reference code so they can be audited.

## Assets

- Encrypted screenshots, OCR text, window and page titles (Application Support directory).
- Redacted semantic events, episodes, candidates, skills, run traces.
- The master key (protected by Electron `safeStorage`, macOS Keychain) and the optional model API key.
- The extension pairing token.
- The user's live desktop: anything the helper can click or type.

## Threats and controls

| # | Threat | Controls | Residual risk |
|---|---|---|---|
| 1 | Malicious webpage or document prompt injection ("ignore your task and send this email") | All visible text is treated as untrusted data. The model only proposes; `packages/core/src/risk` classifies deterministically and `decidePolicy` never lets the model lower a class. External communication, destructive, financial, credential, and sensitive actions always require explicit approval or abort. The system prompt carries a Safety section, but the policy engine and approval UI are authoritative. | A user can still approve a harmful action; the approval panel shows the exact target, text, and risk reasons to make that decision informed. |
| 2 | Malformed or malicious model output | Responses are parsed into the strict `ProposedAction` Zod union; unknown action types, shell commands, scripts, file operations, and unsupported keys are rejected before validation. Coordinates are bounds-checked; keys must be in `KEY_NAMES`. | None beyond the approved action set. |
| 3 | Loopback API abuse by another local process | Server binds `127.0.0.1` only, dynamic port, 6-digit pairing code with 5-minute expiry and attempt limit, 256-bit bearer token stored hashed, `Origin` must match the paired `chrome-extension://` id, body size and rate limits, Zod validation of every request (ADR 0004). | A local process can discover the port and the product name. It cannot submit events or read the allowlist without the token. |
| 4 | Browser extension impersonation | Pairing binds the extension id; tokens are per pairing and revocable from Privacy. The extension never accepts messages from web pages (no `externally_connectable`). | A malicious extension with the user's cooperation could pair; the pairing UI shows browser and id. |
| 5 | Sensitive screenshots at rest | AES-256-GCM per file with a random IV, master key in the OS credential store, files `0600` in a `0700` directory, 24-hour default retention, perceptual dedup keeps the count low, "Delete today" and "Delete all" remove files and rows. Headless smoke and e2e modes, which may use the test-only key protector, refuse to start unless `APPRENTICE_DATA_DIR` points outside the real data directory (`assertIsolatedDataDir`). | A process running as the same user with Keychain access can decrypt. The hardened runtime is signed with `com.apple.security.cs.disable-library-validation` (required for Electron's frameworks under ad hoc signing), so a same-user process can also inject a dylib into the app (for example via `DYLD_INSERT_LIBRARIES` or by swapping a framework in a writable install location) and read keys or plaintext in memory. Both are the macOS same-user boundary: anything running as the user already has the user's authority. |
| 6 | Renderer compromise (XSS in the UI) | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, strict CSP without inline scripts and with `connect-src 'none'`, no remote content, preload exposes only whitelisted channel names, main validates every request against the contract and checks the sender. | A compromised renderer could call any contract channel; consequential channels (run approval, delete-all) still require the same UI confirmation semantics, and no channel can execute arbitrary actions without the run engine's policy path. |
| 7 | Command injection in model-process spawning | `child_process.spawn`/`execFile` with argument arrays only; model paths are resolved inside the app's directories; no `shell: true` anywhere (`grep -r "shell: true"` is part of the review). | None known. |
| 8 | Symlink and path traversal during export and deletion | `assertPathInside` with `realpath` checks, blob ids restricted to `[A-Za-z0-9_-]`, zip entry names validated (no `..`, no absolute, ASCII only), deletion never follows symlinks, delete-all only removes the app's own directory tree. | None known. |
| 9 | Feedback exfiltration | Remote upload is off by default, requires separate consent, uses a strict `.strict()` allowlist schema, rejects forbidden keys at any depth, previews the exact payload before upload, never includes screenshots, OCR, URLs, titles, or typed text; comments require a warning. The Worker enforces the same schema server-side. | A user can type sensitive content into a comment after the warning. |
| 10 | Stale-screen actions | Fresh capture before every action, geometry match within tolerance, perceptual hash comparison with the proposal screenshot, `isStaleScreen` rejects when the screen changed materially or the capture is older than 5 s; target resolution against OCR and accessibility. | Fast UI changes between check and click remain possible; approval-per-step keeps the blast radius to one action. |
| 11 | Wrong recipient or wrong account | External communication is never automatic; the final send action shows the frontmost window title and target label; skills carry allowed apps and domains, and a run aborts if the frontmost app or domain is outside the skill's allowlist. | The user remains the last check for recipient identity. |
| 12 | Package update and model-binary supply chain | No auto-updater; pinned dependency versions with lockfile; `pnpm audit` triage documented in BUILD_STATUS; llama.cpp release pinned by SHA-256, verified before extraction and before execution; model weights pinned by SHA-256 and size; Homebrew fallback is manual. | Upstream compromise of a pinned artifact after we pinned it is out of scope; the checksum would mismatch. |
| 13 | Keystroke and secret capture | The helper emits key events only for chords with command, control, or option; never plain characters. Secure text fields and `IsSecureEventInputEnabled` trigger a privacy pause. Field values and clipboard contents are never read. | None by design; verified by helper tests and code review. |
| 14 | Unattended destructive or financial actions, or actions reaching the helper without approval | Risk classes destructive and financial_or_access map to strong confirmation or unsupported/abort. `low_risk_auto` is behind an experimental flag, default off, and only ever covers read-only actions. The helper performs an action only with a valid approval token: the main process generates a random 32-byte secret per helper spawn and passes it in the child environment (`APPRENTICE_HELPER_SECRET`, never logged); the run engine mints `hex(HMAC-SHA256(secret, canonicalJSON(action)))` from the approved executable action only after approval (`step-runner.ts` `execute`), and the helper recomputes it in constant time over the action it received (`HelperCore.ApprovalTokenVerifier`) before checking permissions or displays. A token cannot be reused for a different action, a mutated action, or a later helper process, and a helper started without a secret refuses every action. | The token authenticates the main process to its own child; it does not defend against a compromised main process, which is the same-user boundary above. |

## Review checklist before release

- [ ] `grep -rn "shell: true" apps packages scripts native` returns nothing.
- [ ] `grep -rn "nodeIntegration: true" apps` returns nothing.
- [ ] Renderer CSP present in `apps/desktop/src/renderer/index.html`.
- [ ] `pnpm audit --audit-level=high` triaged in `docs/BUILD_STATUS.md`.
- [ ] Forbidden-field tests pass in schemas, core, and the Worker.
- [ ] Helper never writes to stdout except protocol lines (test `JSONLinesWriterTests`).
