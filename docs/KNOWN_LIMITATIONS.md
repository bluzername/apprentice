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
- A screenshot is only ever a capture of one window. When macOS will not composite that window
  (it is minimized, or on another Space), and the helper cannot capture it either, no screenshot is
  stored for that moment at all; the events are still recorded (by design, see ADR 0002).

## Learning

- Passive candidates need at least two similar episodes with at least three meaningful actions and
  a median active duration above 90 seconds. Very short or very irregular routines are not proposed.
- Similarity is deterministic and structural. Workflows that look alike but differ in intent can be
  grouped together; use "Wrong boundaries" or "Not useful" to correct.
- Variable detection is heuristic (route ids, differing labels). Free-text variables typed into
  fields are never captured, so they cannot be inferred. Differing file names between occurrences
  are listed as alternatives in the candidate steps, and the derived skill keeps the last
  occurrence's literal name; the variable is not bound into the skill automatically.
- Occurrences are split by a 4-minute idle gap or by an outcome event (save, submit, close).
  Repeating a routine with shorter pauses and without an outcome event (for example pasting into
  Notes, which autosaves) produces one long episode and no candidate.
- Pauses of up to 2 minutes inside a routine count as active time; longer pauses are cut from the
  active duration used by the 90-second gate.
- Skills derived from discovered candidates need a human pass before they are executable: the
  subtask text is built from accessibility labels and omits the intent of the routine (see
  `docs/VALIDATION_REPORT.md`).

## Observation without the browser extension

- Without the companion extension, browser activity is observed only through the frontmost
  window: app switches, coarse window-title view tokens (site plus inbox, search, message,
  document), clicks enriched through Accessibility, and modifier chords. Tabs that are not the
  active tab of the frontmost window are invisible. Install the extension for page-level detail.
- Automated input that bypasses the HID layer (browser automation, scripted keystrokes) is not
  observed and does not count as user activity; this only matters for test harnesses.

## Assisted runs

- Guide and approval-every-step modes only. `low_risk_auto` exists behind an experimental flag,
  is off by default, and covers only read-only actions.
- Supported actions: click, double click, move, scroll, type text, press key, hotkey, wait, ask
  user, done, fail. Drag, triple click, key hold, and any shell or file operation are unsupported
  and rejected.
- Financial, credential, permission, and sensitive-context actions abort as unsupported.
- A run needs the target application to have an open window; if it does not, the run pauses with
  a question instead of acting. Approvals bring the Apprentice window forward; the engine
  re-activates the target application before each capture and action.
- Verification is deterministic-first (predicates, before/after screen and OCR diff); the model's
  own verification is only supporting evidence. Some subtasks end with a user confirmation.
  Actions that do not change the window (Command+S on an unchanged view) are reported as
  unverified even when they succeeded on disk.
- Wall-clock time of a guided run is dominated by approval waits and model latency, not by
  execution: in the measured runs the helper spent under 0.5 s executing per run, the model
  110-250 s, and approvals 120-160 s.
- Every approval brings the Apprentice window forward, so the target window loses key status
  between steps. Actions whose effect depends on the window staying key (Finder inline rename,
  context menus, hover states) do not work one step at a time; Finder rename failed in 3 of 3
  runs for this reason.
- The model sees only the target window; the prompt now names the frontmost app and window title
  so it does not keep re-proposing "bring the app to the front", but a first focus click at the
  start of a subtask is still common and harmless.
- Replacing the app bundle in /Applications by deleting it first resets the macOS Screen
  Recording and Accessibility grants; copy the new bundle over the existing one instead.
- The observer records the assistant's own approved actions as ordinary activity, so guided runs
  can produce candidates for the routine they just executed.
- The credential-shape check on typed text can flag ordinary pipe-delimited data lines as a
  high-entropy token; approval is still possible, the card just shows the warning.
- Coordinates from the model are mapped through the resize transform and checked against OCR and
  accessibility context; ambiguous or moved targets are refused rather than guessed.
- UI-Mate was trained on Ubuntu screenshots. The provider remaps ctrl to command, swaps the two
  Ubuntu-specific system prompt fragments for macOS ones (menu bar, Dock, Finder, Command
  shortcuts, no terminal), and the run engine prefixes the instruction with "You are operating
  macOS." The model's weights are unchanged, so macOS-specific behaviour is still not guaranteed.

## Model

- Demo mode uses a deterministic mock provider; it does not perform real inference.
- The recommended local route (llama.cpp Q6_K) needs about 8.6 GB of downloads and holds about
  11.5 GB of GPU memory at the 32768-token context (measured on an M3 Max, see
  `docs/MODEL_PERFORMANCE.md`). 32 GB of unified memory is recommended, 24 GB is the minimum,
  and 16 GB machines need a smaller quantization or an external endpoint.
- Real inference is slow compared with the demo provider: 8-10 s per proposed action for a
  normal window on an M3 Max at the start of a run, growing to 20-30 s once several screenshots
  are kept in the prompt; dominated by prompt processing. Smaller Apple Silicon chips will be
  proportionally slower; nothing below an M3 Max was measured.
- Grounding accuracy on real macOS windows is 47-59 % within 6 px on a 32-target benchmark (four passes):
  labelled text targets (list rows, labelled buttons, text lines) are reliable, icon-only
  controls (window traffic lights, toolbar glyphs, markup checkboxes) are mostly missed, and
  misses are far rather than near. Sampling temperature and the thinking mode do not change
  this. Details in `docs/VALIDATION_REPORT.md`.
- The official `-c 8192` context is not used because one full-screen Retina capture is about
  7,600 image tokens; the app pins 32768 and caps the model image at 1920 px on the long edge.
- Replies are capped at 2048 tokens for the managed runtime; a proposal that needs more thinking
  fails the step as invalid_action instead of taking minutes.
- Captures are window-scoped, so a dialog from another app that overlaps the target window is not
  in the image the model sees. The residual is the reverse case: the model can propose a click at a
  point where another window physically sits, and the hit-test guard then finds an element owned by
  a different app and refuses the action rather than clicking through. Move the overlapping window
  and continue the run.
- The first proposal of a run can be rejected as a stale screen when the target window is still
  repainting after activation; the run retries once automatically.

## Feedback

- Remote upload requires a deployed Worker; the alpha bundle documents deployment but does not
  include a hosted endpoint. Local export and offline aggregation work without it.
- Pulse prompts on day 1, 3, and 7 rely on the app being opened on those days.

## Not supported in the alpha

- Team collaboration, multiple profiles, payments, purchases, account changes, credential entry,
  unattended destructive actions, autonomous sending of email or messages.
