# Model performance and hardware requirements

Measured facts only. Everything below was recorded on one machine on 2026-09-03
with the pinned runtime and model; nothing is extrapolated from vendor claims.

## Test machine

| Item | Value |
|---|---|
| Mac | Apple M3 Max, 14 CPU cores (10 performance + 4 efficiency), 30 GPU cores |
| Unified memory | 36 GB |
| Display | Built-in Retina 3456 x 2234 (2x scale) |
| macOS | Darwin 25.6.0 |
| Runtime | llama.cpp b10752 (`llama-server`, Metal), pinned in `scripts/model-manifest.json` |
| Model | UI-Mate-9B, Q6_K GGUF (7.70 GB) + f16 mmproj (0.92 GB), `bartowski/tencent_UI-Mate-9B-GGUF` |
| Provider | `uimate` (exact port of the official agent prompt and parser) |

Other apps were running during every measurement (Claude desktop, Chrome,
Safari, Finder, Preview, TextEdit, Apprentice), which is the realistic condition
for an assistant that runs next to the user's work.

## How the numbers were produced

- `node scripts/install-local-runtime.mjs` and `node scripts/install-uimate-model.mjs --yes`
  downloaded and hash-verified the runtime and weights (8.62 GB in about 16 minutes).
- `node scripts/start-local-model.mjs --port 8000 --ctx <N>` started the server;
  load time is the wall time from spawn until `GET /health` returned 200.
- `pnpm bench:local-model` (`packages/model-adapters/bench/local-model-bench.test.ts`)
  sends real screenshots of this Mac through the real `UIMateProvider` and records
  the wall time around each proposal, llama-server's own `timings` and `usage`
  fields, the llama-server RSS (`ps`), and the GPU accelerator's "In use system
  memory" (`ioreg -c IOAccelerator`) sampled every 500 ms. The raw report JSON
  files are in `docs/benchmarks/`; the tables below are derived from them.
- Screenshots: a 2x Finder window capture (1840 x 984, the size the run engine
  actually sends for a normal window), and the full screen at 2x (3456 x 2234),
  1x (1728 x 1117) and 0.66x (1152 x 744).

## Load time and memory

| Context | Time to healthy | llama-server RSS | GPU memory in use (whole system) |
|---|---|---|---|
| none (server stopped) | - | - | 0.85 GB |
| 8192 | 7 s (weights freshly written, page cache warm) | 6.6 GB idle, 7.4 GB peak | 10.5 GB idle, 10.6 GB peak |
| 32768 | 2 s (second start, weights cached) | 9.8 GB idle, 10.7 GB peak | 11.8 GB idle, 11.5 GB during inference |

The ~9.7 GB GPU delta at 8192 is the weights plus the mmproj and compute
buffers; 32768 costs about 1.4 GB more for the KV cache. A cold start after a
reboot will be slower than 7 s because 8.6 GB has to come off disk; that case
was not measured.

## Per-step latency

Token counts are what llama-server reported. The fixed prefix (system prompt,
tools block, workflow guidance, safety section) is 2,223 tokens and is served
from the prompt cache after the first request of a session. Image tokens are
(width / 32) x (height / 32) after the official `process_image` rounding.

Context 8192, provider default of 5 screenshots kept (the desktop app now keeps 2):

| Screenshot | Model input | Image tokens | Prompt tokens (turn 1 / 2) | Prefill | Generation | Wall time (turn 1 / 2) |
|---|---|---|---|---|---|---|
| Finder window 2x, 1840 x 984 | 1856 x 992 | 1,798 | 4,216 / 6,109 | 296-310 tok/s | 131-182 tok at 32 tok/s | 12.1 s / 10.5 s |
| Full screen 0.66x, 1152 x 744 | 1152 x 736 | 828 | 3,246 / 4,165 | 340-360 tok/s | 135-175 tok at 32 tok/s | 7.1 s / 8.2 s |
| Full screen 1x, 1728 x 1117 | 1728 x 1120 | 1,890 | 4,308 / 6,293 | 272-294 tok/s | 124-166 tok at 32 tok/s | 12.2 s / 11.2 s |
| Full screen 2x, 3456 x 2234 | 3456 x 2240 | 7,560 | 6,447 / 10,571 | 220 tok/s | 140 tok at 32 tok/s | 23.7 s / HTTP 400 |

The second full-screen 2x request was rejected: "request (10571 tokens) exceeds
the available context size (8192 tokens)". A maximized window on a Retina Mac
therefore cannot complete a two-step subtask at the official `-c 8192`. The
context pin was raised to 32768 in the manifest and both argument builders.

Context 32768, 3 turns per scenario, 5 screenshots kept:

| Screenshot | Prompt tokens (turn 1 / 2 / 3) | Wall time (turn 1 / 2 / 3) |
|---|---|---|
| Finder window 2x | 4,216 / 6,109 / 8,000 | 15.3 s (cold cache) / 10.5 s / 10.5 s |
| Full screen 1x | 4,308 / 6,289 / 8,272 | 12.1 s / 12.3 s / 11.2 s |
| Full screen 2x | 6,447 / 10,578 / 14,702 | 26.0 s / 22.2 s / 27.3 s |

Generation speed stayed at 29-33 tok/s in every run; the wall time is dominated
by prefill of the new screenshot (about 1,800-4,200 uncached tokens per step)
plus 4-7 s of generation for the 110-220 token reply. The thinking block is
short with this checkpoint; replies stayed well under 300 tokens.

## Screenshot history and the prompt cache

The official agent keeps the last N screenshots in the conversation
(`imagesToKeep`) and collapses older ones to a text placeholder, pinning the
step-0 screenshot. llama-server reuses the KV cache only for an unchanged prompt
prefix, so the two strategies behave very differently. Measured at context
32768 with a different screenshot on every turn (a marker square painted at a
turn-specific position) so image tokens could not be reused across turns:

| History | Screenshot | Prompt tokens per turn | Uncached tokens per turn | Wall time per turn |
|---|---|---|---|---|
| keep 5 (append only) | Finder window 2x | 4,216 / 6,106 / 7,994 / 9,884 | 1,993 / 1,894 / 1,892 / 1,894 | 14.6 s (cold) / 9.5 s / 10.1 s / 10.2 s |
| keep 5 (append only) | Full screen capped to 1920 x 1248 | 4,758 / 7,190 / 9,623 / 12,073 | 2,535 / 2,436 / 2,437 / 2,454 | 17.8 s / 13.9 s / 17.3 s / 16.6 s |
| keep 5 (append only) | Full screen 2x, 3456 x 2240 | 6,447 / 10,575 / 14,697 / 18,821 | 4,224 / 4,132 / 4,126 / 4,128 | 22.8 s / 29.2 s / 25.8 s / 27.3 s |
| keep 2 | Finder window 2x | 4,216 / 6,109 / 6,205 / 6,301 | 1,993 / 1,897 / 3,982 / 4,078 | 17.2 s / 11.6 s / 20.0 s / 20.2 s |
| keep 1 | Finder window 2x | 4,216 / 4,312 / 4,451 | 1,993 / 100 / 143 | 14.6 s / 7.8 s / 6.2 s |

Reading the table:

- With an append-only history every step pays for exactly one new screenshot.
- With `imagesToKeep` 2, the third step and every step after it rewrite the
  prompt, the cache falls back to the 2,223-token fixed prefix, and prefill
  doubles (about 4,000 uncached tokens, 20 s per step for a plain window).
- With `imagesToKeep` 1 the official collapse rule pins the step-0 screenshot
  and drops the newest one, so the model never sees the current screen after
  step 0 (its replies became "scroll to look for a Finder window"). Never use 1.
- Generation stayed at 27-33 tok/s throughout; replies were 100-330 tokens.

Decisions taken from this data (all in `scripts/model-manifest.json` and
`apps/desktop/src/main/services/images/png-resize.ts`):

1. Context 32768 instead of the official 8192.
2. `imagesToKeep` 8 instead of 2, so a subtask of up to 8 steps never collapses
   and every step costs one screenshot of prefill. Sessions reset per subtask.
3. The model image is capped at 1920 px on the long edge, so a maximized
   Retina window costs about 2,450 uncached tokens per step instead of 4,200,
   and eight kept screenshots plus history stay under 24k tokens.

## What this means for the user experience

- A normal window (the common case: the run engine captures the target window,
  not the whole display) costs 10-12 s per proposed action on an M3 Max.
- A maximized or full-screen Retina window costs 14-18 s per action after the
  1920 px cap (22-29 s uncapped).
- Each subtask starts a fresh model session, so prompt growth is bounded by the
  number of steps in a subtask; up to 8 steps keep the prompt cache warm.

## Guided runs in the packaged app

Two rounds of guided runs were driven end to end in the packaged app with the
managed runtime (provider `uimate`, context 32768, replies capped at 2048
tokens), against real Finder, Preview and TextEdit windows. The first round
(six runs, thinking on) established the per-phase costs; the second round (seven
runs on 2026-09-04, thinking off, temperature 0.2, one server slot) was part of
the validation described in `docs/VALIDATION_REPORT.md`. Timings come from the
persisted run steps (`timing` on each step).

| Phase | Measured range | Notes |
|---|---|---|
| Capture (window capture + resize + OCR) | 185-1,240 ms | first capture of a run is the slowest |
| Proposal (real model, thinking on) | 8.7-20.8 s typical, one outlier of 70.2 s | the outlier was a 1,300-token thinking reply before the 2048 cap |
| Proposal (real model, thinking off) | 8-10 s for the first four steps, 20-30 s once 5-7 screenshots are in the window | prefill-bound (3.8k prompt tokens per single-screenshot request take 9.9 s median on an idle server) |
| Approval wait | 8-73 s | human (or the test driver) reading the card |
| Execution through the helper | 12-162 ms | click 39-66 ms, double-click 127-162 ms, hotkey 25-53 ms, key 12-14 ms |
| Verification (after capture + OCR diff) | 366-1,627 ms | plus a 600 ms settle before it |
| Whole step, model + machine only | about 9-32 s | approval wait excluded |

What the runs proved:

- Two runs of a three-subtask skill ("open the new invoice PDF in Preview, close
  it, append a line to ledger.txt in TextEdit and save") completed end to end,
  each with 6 approved actions executed through the helper with HMAC approval
  tokens and verified by screen and OCR diff, and each leaving the exact
  expected line in the ledger on disk. Wall clock 5 m 11 s and 4 m 04 s, of which
  the model accounted for 125 s and 109 s, helper execution for under 0.3 s, and
  approval waits for 143 s and 123 s.
- Engine-owned subtask completion works: a subtask whose completion predicate is
  "Preview is frontmost" was closed by the engine from the post-action evidence
  without a model signal in every run that reached it.
- Actions the model proposed on its own and that executed correctly: Finder
  double-clicks, Command+W, a click at the end of the last text line, Return,
  typed text shown verbatim on the approval card, Command+S, and the context-menu
  "Rename..." path in Finder.
- Rejections end the run as `user_rejected`, an action targeting a foreign
  window (a macOS permission dialog owned by UserNotificationCenter, or a window
  of another app covering the target) is refused by the hit-test guard as
  `invalid_action`, and the run stops after two refusals.
- Memory during the runs: llama-server RSS 8.9-9.8 GB, GPU memory in use
  11.2-11.7 GB, Apprentice main process 150-170 MB, native helper 26-60 MB;
  system free memory stayed at 25-35 % next to Chrome, Safari and the Claude
  desktop app.

What the runs showed as limits:

- Saving with Command+S does not change the window pixels, so the screen-diff
  verifier reports it as unverified even when the file on disk changed. A file
  system predicate is the right check for save steps.
- Model latency grows with the number of screenshots kept in the prompt. With 8
  images kept, proposals went from about 9 s (steps 1-4) to 20-30 s (steps 5-7)
  within one run. Keeping fewer images trades accuracy on long runs for speed.
- A skill created from a discovered candidate without human editing carries
  accessibility-label wording ("Open 'summary.txt' on textedit") and the last
  occurrence's literal file name instead of a bound variable. The engine drives
  such a skill, but the model follows the literal text and does not perform the
  intent (copying a value between files), so a human pass over the subtask text
  is still required before a discovered routine is executable.

## Realistic hardware requirements

| Unified memory | Verdict for the managed Q6_K route |
|---|---|
| 36 GB (tested) | Comfortable: 11.5 GB for the model next to a browser, Claude desktop and the app; free memory stayed above 25 %. |
| 32 GB | Expected to work with the same margins minus 4 GB; not tested. |
| 24 GB | Minimum for Q6_K at 32768 context: about 11.5 GB for the model leaves ~12 GB for macOS and the user's apps. Expect swapping if a heavy browser session is open. Not tested. |
| 16 GB | Not viable with Q6_K. Use `IQ4_XS` or `Q4_K_M` from the same repository (about 5-6 GB weights), a 16384 context, and an external endpoint via Settings > Model. Not tested. |

GPU-bound work: the CPU stayed mostly idle during inference (the server process
used one core for the HTTP and tokenizer paths). Apple Silicon with fewer GPU
cores (M1/M2 base, M3 base) will prefill proportionally slower; an M2 with 10
GPU cores would be roughly 3x slower than the 30-core M3 Max measured here,
which is an estimate, not a measurement.
