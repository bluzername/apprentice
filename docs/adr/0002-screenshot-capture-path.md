# ADR 0002: Screenshot capture runs in the Electron main process; the helper owns AX and actuation

Status: accepted (2026-09-02)

## Context

macOS Transparency, Consent, and Control (TCC) attributes Screen Recording permission to a
code-signed responsible process. A helper executable bundled inside the `.app` and spawned by the
Electron main process is usually attributed to the app, but the attribution depends on the
launch path and on code-signing details, and an Electron app cannot detect a mismatch until a
capture silently returns a black or empty image. The specification requires that we never ship a
permission flow that appears granted but cannot capture reliably.

## Decision

- Default capture path: Electron main process using `desktopCapturer.getSources` (a supported
  Electron API backed by ScreenCaptureKit on macOS 14+) combined with the helper's
  `frontmostContext` result to crop the display capture to the frontmost window bounds. Permission
  status is read with `systemPreferences.getMediaAccessStatus("screen")`, which reports the same
  identity that `desktopCapturer` uses. Granted therefore means capturable.
- Secondary path: the helper's `captureFrontmostWindow` (ScreenCaptureKit, CGWindowList fallback)
  behind the `captureViaHelper` setting for diagnostics and for a future native rewrite.
- Accessibility (AXUIElement), CGEvent actuation, Vision OCR, and the observation event tap stay in
  the helper. Accessibility permission for the helper is attributed to the app bundle because the
  helper is a child process inside the bundle; the onboarding flow shows the live status reported
  by the helper (`AXIsProcessTrusted`) so a mismatch is visible immediately.

## Consequences

- The app needs one Screen Recording grant and one Accessibility grant, both shown under the app
  name in System Settings.
- OCR round-trips a PNG through the JSONL protocol (base64). Screenshots are resized to at most
  1280 px on the long edge before OCR, so this stays under a few hundred kilobytes.
- Verification on a real machine requires interactive permission prompts; see
  docs/BUILD_STATUS.md for the manual check list.
