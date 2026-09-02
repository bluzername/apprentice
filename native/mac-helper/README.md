# apprentice-helper (native macOS helper)

Swift Package that builds the arm64 command-line helper `apprentice-helper`
for Apprentice. The Electron main process spawns it and talks JSON Lines over
stdin/stdout. It owns everything that needs Apple frameworks: Accessibility
(`AXUIElement`), ScreenCaptureKit, CoreGraphics event synthesis, Vision OCR,
and NSWorkspace metadata.

Targets:

- `HelperCore` (library, no Apple UI frameworks): protocol codecs, geometry,
  key-code and modifier maps, action validation, fixture parsing, AX role to
  semantic role mapping. Fully unit tested.
- `apprentice-helper` (executable): the process itself. Links AppKit,
  ApplicationServices, ScreenCaptureKit, Vision, CoreGraphics, ImageIO, Carbon.
- `HelperCoreTests` (XCTest).

Requirements: macOS 14+, Xcode 26 / Swift 6.x toolchain (language mode 5).

## Build and test

```bash
cd native/mac-helper
swift build -c release --arch arm64      # or ./build.sh, which prints the binary path
swift test
.build/arm64-apple-macosx/release/apprentice-helper --self-test
```

`build.sh` prints `.build/arm64-apple-macosx/release/apprentice-helper` on
success. The repo-level `pnpm build:helper` and `pnpm test:swift` wrap these.

## Protocol

Authoritative schema: `packages/schemas/src/helper-protocol.ts` and
`packages/schemas/src/actions.ts`. The Swift side mirrors them by hand;
`HelperCoreTests` pins the command list, error codes, and key names.

- stdin: one request per line, `{"id":"<string>","v":"1.0","cmd":"<name>","params":{...}}`.
- stdout: exactly one JSON object per line, flushed immediately. Either a
  response `{"type":"response","id","v","ok","result"?,"error"?}` or an event
  `{"type":"event","v","event","ts","seq","data"}`. `ts` is a millisecond epoch
  as a double; `seq` is monotonic for the life of the process.
- stderr: all logs, prefixed `[helper]`. Never parse stderr.
- Malformed JSON lines answer with `id:"unknown"` and `invalid_request`.
  Unknown `cmd` answers `unknown_command`. Wrong `v` answers `invalid_request`.
- EOF on stdin shuts the helper down cleanly. SIGPIPE is ignored.

Error codes: `invalid_request`, `unknown_command`, `permission_denied`,
`not_available`, `capture_failed`, `ocr_failed`, `action_rejected`,
`emergency_stopped`, `internal`.

### Commands

| cmd | params | result |
| --- | --- | --- |
| `ping` | | `{pong, ts, stopped}` |
| `capabilities` | | `CapabilitiesResultSchema` |
| `permissionStatus` | | `{accessibility, screenRecording, inputMonitoring}` each `granted` or `denied` |
| `requestAccessibilityPermission` | | shows the system prompt, returns permission status |
| `requestScreenRecordingPermission` | | shows the system prompt, returns permission status |
| `startObservation` | `{fixturePath?, idleThresholdSeconds?}` | observation state (see events) |
| `stopObservation` | | `{observing:false, fixture:false}` |
| `frontmostContext` | | `FrontmostContextResultSchema` |
| `captureFrontmostWindow` | | `CaptureResultSchema` (`method` is `screencapturekit` or `cgwindowlist`) |
| `ocrImage` | `{pngBase64}` | `{width, height, blocks[]}` in image pixels, top-left origin |
| `focusedElement` | | `{element, bundleId}` |
| `accessibilityContextAtPoint` | `{x, y}` display points | `{element, ancestors[<=12], bundleId}` |
| `performAction` | `{action, approvalToken}` | `{performed, durationMs}` |
| `emergencyStop` | `{clear?: bool}` | `{stopped}` |
| `shutdown` | | `{shuttingDown:true}` then exit 0 |

`performAction` is validated entirely in `HelperCore.ActionValidator` before
any `CGEvent` is created: key names must be in `KEY_NAMES`, modifiers in
`MODIFIER_NAMES`, coordinates finite and inside the union of active display
bounds, `type_text` at most 2000 characters, `approvalToken` 8-128 characters.
Violations return `action_rejected`. While the emergency-stop flag is set every
action returns `emergency_stopped`; `type_text` chunks, multi-click sequences,
hotkey chords, and `wait` all re-check the flag between steps.

Scroll convention: positive `deltaY` scrolls content down (browser wheel
semantics); the helper negates for CoreGraphics.

`emergencyStop` is handled on the stdin reader thread, ahead of the serial
command queue, so it responds immediately even while an action is running. It
also releases any modifier keys a hotkey sequence is holding.

### Events

| event | data |
| --- | --- |
| `helperReady` | `{helperVersion, protocolVersion, pid}` on startup |
| `observationState` | `{observing, fixture, mouseEvents?, accessibilityEvents?, idleThresholdSeconds?, eventCount?, completed?}` |
| `frontmostAppChanged` | `{bundleId, name, pid}` from `NSWorkspace.didActivateApplicationNotification` |
| `windowTitleChanged` | `{bundleId, windowId?, title}` from an AX observer re-attached on every app switch |
| `mouseDown` | `{x, y, button, bundleId}` display points, listen-only event tap |
| `shortcut` | `{keys:["cmd","shift","p"], bundleId}` only when command, control, or option is held |
| `clipboardChanged` | `{changeCount}` polled once per second; contents are never read |
| `idleChanged` | `{idle, idleSeconds}` polled every 5 s against `idleThresholdSeconds` (default 240) |
| `secureFieldFocused` | `{bundleId, role}` when focus lands on `AXSecureTextField` or secure event input turns on |

Privacy invariants enforced here: no plain keystrokes are ever emitted (the
tap drops key events without a command/control/option chord), secure-field
values are never read, and text fields report only `valueLength`.

Degraded mode: if the event tap cannot be created (no Input Monitoring or
Accessibility grant) `startObservation` still succeeds and reports
`mouseEvents:false`; the reason is logged to stderr. The same applies to the
AX observer (`accessibilityEvents:false`).

## Permissions and TCC identity

The helper is bundled inside the Electron `.app`. TCC attributes prompts to
the *responsible process*, which for a child process launched by the app is
the app bundle itself, so:

- Accessibility: `requestAccessibilityPermission` calls
  `AXIsProcessTrustedWithOptions` with the prompt option. The prompt names the
  Electron app; the grant covers the helper because it inherits the app's
  responsibility. When running the helper standalone from a terminal, the
  terminal is the responsible app and must be granted instead.
- Input Monitoring: the listen-only event tap needs Input Monitoring or
  Accessibility. `permissionStatus.inputMonitoring` uses
  `CGPreflightListenEventAccess`.
- Screen Recording: `permissionStatus.screenRecording` uses
  `CGPreflightScreenCaptureAccess`. `captureFrontmostWindow` refuses with
  `capture_failed` (without prompting) when it is not granted.

Capture path decision: in the product, screenshot capture defaults to the
Electron main process (`desktopCapturer`), because a separately-signed helper
can otherwise appear as a second Screen Recording identity and a grant that
looks complete may not apply to the process doing the capture. The helper's
`captureFrontmostWindow` is the secondary path, kept for parity and for the
case where the app decides the helper identity is reliable on a given machine.
Accessibility inspection and actuation always stay in the helper.

The preflight APIs only distinguish granted from not granted; the helper never
reports `not_determined` because macOS does not expose it without prompting.

## Fixture-stream mode

`startObservation` with `fixturePath` replays a JSONL file instead of
observing. Each line is `{"delayMs":number,"event":string,"data":object}`;
blank lines and `#` comments are ignored. Events are emitted with real
timestamps and the shared `seq` counter, and `observationState` marks start
and completion. `stopObservation` cancels a replay.

`--fixture <path>` starts the replay immediately after `helperReady` while
still serving stdin. `--self-test` prints capabilities as a response line and
exits 0.

Sample: `Fixtures/sample-observation.jsonl` (18 events, every event type).

```bash
# keep stdin open; EOF on stdin is the shutdown signal
sleep 15 | .build/arm64-apple-macosx/release/apprentice-helper --fixture Fixtures/sample-observation.jsonl
```

## Layout

```
Package.swift
build.sh
Fixtures/sample-observation.jsonl
Sources/HelperCore/          protocol, geometry, keys, actions, fixture, AX mapping
Sources/apprentice-helper/   main, server, router, permissions, AX, capture, OCR, actions, observation
Tests/HelperCoreTests/       XCTest suite
```
