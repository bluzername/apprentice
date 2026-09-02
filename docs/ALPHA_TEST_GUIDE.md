# Apprentice alpha test guide

Thank you for testing Apprentice. It is a local-first agent that watches only the apps and
sites you allow, notices routines you repeat, shows you what it learned, and helps one approved
action at a time. Nothing leaves your Mac unless you opt in to structured feedback.

## 1. System requirements

- Apple Silicon Mac (M1 or later). Intel Macs are not supported.
- macOS 14 Sonoma or later.
- 16 GB unified memory for observation, teaching, and demo mode. 24 GB or more recommended for
  the full local model experience (about 8.6 GB of model files on disk plus 10 GB while running).
- Chrome, Arc, Brave, or Edge if you want browser-level detail (optional extension).

## 2. Installation

1. Open the `.dmg` (or unzip the `.zip`) and drag `Apprentice.app` to Applications.
2. Verify the download: `shasum -a 256 -c SHA256SUMS.txt` in the bundle folder.
3. First launch and Gatekeeper. This alpha is signed but not notarized unless the release notes say
   otherwise. macOS may show "Apprentice cannot be opened because Apple cannot check it". Do this:
   right-click the app, choose Open, then Open again; or go to System Settings > Privacy & Security
   and click "Open Anyway" next to the Apprentice message. You only need to do this once. Never
   disable Gatekeeper system-wide.

## 3. Onboarding (about three minutes)

1. Local-first explanation: read what stays on the Mac.
2. Hardware check: confirms chip, memory, disk, macOS, and recommended experience level.
3. Privacy scope: your allowlist starts EMPTY. Add the apps and browser domains you want observed.
   Suggestions are shown but never preselected. Password managers, banking, payments, health
   portals, and system dialogs are always denied.
4. Permissions: Apprentice needs Screen Recording (to capture sparse screenshots of allowed windows)
   and Accessibility (to read element roles and perform approved clicks). Click each button, allow
   in System Settings, and wait for the badges to turn green. If a badge stays red after granting,
   quit and reopen the app (macOS applies some grants only on relaunch).
5. Model setup: choose one.
   - Demo mode: no model; everything works with synthetic data and a deterministic mock.
   - Existing endpoint: any OpenAI-compatible local server (base URL ending in `/v1`, model name,
     optional key). Use "Test connection".
   - Recommended local route: downloads llama.cpp (11 MB, checksum verified) and UI-Mate-9B Q6_K
     (about 8.6 GB) after you confirm the source, license, and disk use. See MODEL_SETUP.md.
   - Advanced MLX: run `node scripts/setup-mlx-route.mjs` from the source tree; see MODEL_SETUP.md.
6. Feedback consent: local feedback is always stored on your Mac. Remote structured feedback is
   off unless you enable it; you can preview the exact payload at any time.
7. Start Learning mode. The menu bar icon shows the status at all times.

## 4. The optional Chromium extension

1. Unzip `apprentice-extension.zip` to a folder you keep.
2. In Chrome/Arc/Brave/Edge open `chrome://extensions`, enable Developer mode, click "Load
   unpacked", and select the folder.
3. In Apprentice, open Privacy > Browser extension > "Show pairing code".
4. Click the extension icon, enter the six-digit code, click Pair.
5. Click "Grant access for N domains" so the extension can run on the domains in your allowlist
   (it asks for those sites only, never all sites). Reload any tabs that were already open.

The extension only talks to the Apprentice app on 127.0.0.1 and never reads field values,
clipboard contents, password fields, or private windows. See EXTENSION_INSTALL.md.

## 5. Using Learning mode

- Menu bar statuses: Learning, Paused, Private, Processing locally, Model unavailable, Stopped.
- Menu bar actions: Pause for 15 minutes, Pause until resumed, Enter Private mode, Learn what I just
  did, Open dashboard, Stop all local model work.
- Anything outside your allowlist appears in Activity as a grey "not captured" gap.

## 6. Teaching a workflow ("Learn what I just did")

1. Do a routine (three to twelve steps, a few minutes) in allowed apps or sites.
2. Press Option+Command+L (configurable in Settings) or use the menu bar.
3. Drag the start and end handles over the last 15 minutes, untick private or irrelevant steps.
4. Click "Generate draft". Review the retention preview (exactly what will be kept).
5. Edit the name, trigger, steps, variables, success criteria, allowed apps and domains, and the
   approval policy. Save. The skill is versioned; every later edit records a correction.

## 7. Reviewing candidates and running a skill

- Candidates appear after Apprentice has observed a similar sequence at least twice. Each card shows
  how many times it was observed, the trigger, numbered steps, variables, expected outcome,
  duration, weekly time, confidence with an explanation, evidence, and a risk level.
- Actions: Try once, Edit and save, Not useful, Wrong boundaries, Private workflow, Already
  automated, Never learn this pattern. After a rejection you get a short structured form.
- Runs: open a skill and choose "Run in guide mode". For each step you see the proposed action on an
  annotated screenshot, the exact text it would type, the risk class and why, and buttons to
  approve once, approve low-risk steps for this run, or reject. Typing and anything that sends,
  submits, deletes, pays, or signs in always requires your approval; payments, credentials, and
  permission changes are refused.

## 8. Pausing instantly

- Press Escape while a run is active (works from any app) or use the Stop button or the menu bar.
- Menu bar > Pause or Private mode stops all observation immediately.

## 9. Inspecting and deleting data

- Activity shows the timeline with blurred screenshots (click to reveal) and delete controls.
- Privacy shows stored size, screenshot count, retention sliders, allowlist, exclusions, and:
  Delete today, Delete selected workflow, Delete all local data (type "delete everything").
- Data lives in `~/Library/Application Support/Apprentice/` (open it from Privacy).

## 10. Sending feedback

- Every candidate and run has a short structured form. A pulse question appears on days 1, 3, 7.
- Feedback > "Export feedback bundle" writes a sanitized `.apprentice-feedback.zip` (no screenshots
  unless you pick and preview each one). Send it to the alpha coordinator by your usual channel.
- If remote feedback was enabled and an endpoint is configured, "Upload now" sends only the previewed
  structured payload.

## 11. Demo mode

Settings > Demo mode > "Load 3 days" fills the app with synthetic activity for three workflows
(post-meeting follow-up, invoice processing, candidate review). You can watch candidates appear,
create and edit skills, run a guided run with the mock model, approve actions, verify, give
feedback, and export a bundle without any real data. "Reset demo" removes it.

## 12. Known limitations and unsupported actions

See KNOWN_LIMITATIONS.md. Unsupported in the alpha: payments, purchases, permission changes,
account recovery, credential entry, unattended destructive actions, autonomous sending of email or
messages, drag actions, and anything outside your allowlist.

## First five test scenarios

1. Fresh install, onboarding with an empty allowlist, grant both permissions, start Learning.
   Confirm the menu bar status and that a non-allowlisted app shows a privacy gap in Activity.
2. Load demo mode, wait for the three candidate cards, open the evidence timeline, submit a
   candidate feedback form, then "Try once" and complete the guided run by approving each step.
3. Teach a real workflow with Option+Command+L in an allowed app, trim the range, exclude one step,
   save, then edit the skill and confirm version 2 with a correction entry.
4. Pause for 15 minutes, do work in an allowed app, confirm nothing was captured, resume, and
   confirm capture restarts. Repeat with Private mode.
5. Export a feedback bundle, run "Delete today", then "Delete all local data" and confirm the data
   folder only contains a fresh database and settings.
