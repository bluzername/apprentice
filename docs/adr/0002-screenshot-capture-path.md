# ADR 0002: Screenshot capture runs in the Electron main process; the helper owns AX and actuation

Status: accepted (2026-09-02); amended 2026-09-04 (window-scoped capture is the default)

## Context

macOS Transparency, Consent, and Control (TCC) attributes Screen Recording permission to a
code-signed responsible process. A helper executable bundled inside the `.app` and spawned by the
Electron main process is usually attributed to the app, but the attribution depends on the
launch path and on code-signing details, and an Electron app cannot detect a mismatch until a
capture silently returns a black or empty image. The specification requires that we never ship a
permission flow that appears granted but cannot capture reliably.

## Decision

Capture stays in the Electron main process, and Accessibility (AXUIElement), CGEvent actuation,
Vision OCR, and the observation event tap stay in the helper. Accessibility permission for the
helper is attributed to the app bundle because the helper is a child process inside the bundle; the
onboarding flow shows the live status reported by the helper (`AXIsProcessTrusted`) so a mismatch is
visible immediately.

Permission status is read with `systemPreferences.getMediaAccessStatus("screen")`, which reports the
same identity that `desktopCapturer` uses. Granted therefore means capturable.

The capture itself is window-scoped, through a three-rung ladder implemented in
`apps/desktop/src/main/services/observation/window-screen-source.ts`. Every capture carries the rung
that produced it in `ScreenCapture.method`, logged at debug level.

1. `window_source`: `desktopCapturer.getSources({ types: ["window"] })`, matched to the CGWindowID
   the helper reports in `frontmostContext`. Electron's macOS window source ids are
   `window:<CGWindowID>:0`, so the match is exact and no other source is inspected - a window
   source's `name` is that window's title, and enumerating titles of windows the user never
   allowlisted would itself be a leak. The thumbnail is requested at window bounds x display scale
   and rejected when the returned image is empty or not that size. This image contains only the
   target window: anything stacked on top of it (a permission dialog from another app, a notification)
   is not in the picture, which is why this rung is the default.
2. `helper_window`: the helper's `captureFrontmostWindow` (ScreenCaptureKit, CGWindowList fallback),
   used when rung 1 has no match or returns an implausible image, and used first when the
   `captureViaHelper` setting is on. That setting is now a real diagnostic override rather than dead
   configuration; there is no UI for it.
3. `display_crop`: a whole-display capture cropped to the window bounds when they are known. It is
   always flagged `isDisplayFallback`, so the passive path drops it before storage and OCR and a run
   refuses to act on it. It exists only so a run can tell the user why it stopped.

## Consequences

- The app needs one Screen Recording grant and one Accessibility grant, both shown under the app
  name in System Settings. The TCC concern that motivated the original decision is unchanged: rung 1
  runs under the app's own identity, so the permission the user granted to the app is the permission
  that captures. Rung 2 is the only rung that depends on the helper's attribution, and it is now a
  fallback rather than a co-default.
- Coordinate mapping is unchanged. The capture's origin comes from the helper's window bounds and
  its extent from the returned image, so `ImageTransform` (packages/core/src/geometry) keeps working
  exactly as it did for the old display crop.
- A window that is minimized, on another Space, or otherwise not composited may return an empty
  image; the ladder then drops to rung 2 and, failing that, to a refused display fallback.
- OCR round-trips a PNG through the JSONL protocol (base64). Screenshots are resized to at most
  1280 px on the long edge before OCR, so this stays under a few hundred kilobytes.
- Verification on a real machine requires interactive permission prompts; see
  docs/BUILD_STATUS.md for the manual check list.
