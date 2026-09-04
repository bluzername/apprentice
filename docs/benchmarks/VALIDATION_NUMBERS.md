# Validation report numbers

Every number in `docs/VALIDATION_REPORT.md` with the file and field it came from. File names refer to `docs/benchmarks/` for JSON exports and to the session notes and driver logs (not included in the repository) for timeline facts.

Every figure used in `VALIDATION_REPORT.md`, `linkedin-post.md` and `charts/`, with the file and
field it came from. Paths are relative to
the session working directory (not in the repository) unless they start with `repo:` (which means
`/Users/xx/git/workflow_automator_v1/`).

Abbreviations: `M-FINAL` = `validation-runs-2026-09-04.json` (the final 23:40-onwards export, 11 runs, superseding `metrics-0220/0230/0255.json` and `validation-runs-2026-09-04.json`); `M-S6` = `validation-learning-late-2026-09-04.json` (the 02:40-onwards window covering the final learning scenarios); `G-off` = `grounding-2026-09-04-thinking-off-temp0.2.json`;
`G-on10` = `grounding-2026-09-04-thinking-on-temp1.0.json`; `G-on02` = `grounding-2026-09-04-thinking-on-temp0.2.json`; `G-clean` = `grounding-2026-09-04-thinking-off-temp0.2-clean.json` (the reference pass);
`NOTES` = `REPORT-NOTES.md`.

## Setup and environment

| Number | Value | Source |
|---|---|---|
| Mac, cores, memory, display | M3 Max, 14 CPU / 30 GPU cores, 36 GB, Retina 2x | repo:docs/MODEL_PERFORMANCE.md "Test machine" |
| Runtime | llama.cpp b10752 | repo:docs/MODEL_PERFORMANCE.md; task brief |
| Model / quantization / sizes | UI-Mate-9B Q6_K 7.70 GB + mmproj 0.92 GB | repo:docs/MODEL_PERFORMANCE.md "Test machine" |
| Provider name | `uimate` | `M-FINAL` -> `runs[].provider` |
| Context 32,768; image cap 1920 px | as stated | repo:docs/MODEL_PERFORMANCE.md "Decisions taken from this data" |
| Merged tree rebuilt and relaunched | 01:08 | `NOTES` timeline; `app-night4.log` first line 23:09:18Z |
| Signed arm64 dmg + zip rebuilt at 02:08 | electron-builder 26.15.3, Developer ID Application, not notarized | `build-night4.log` tail (file written 02:08) |
| Demonstration pacing (2-4 s, 100-180 s per occurrence) | as stated | `SCENARIOS.md` "Common rules" |

## Scenarios and demonstrations

| Number | Value | Source |
|---|---|---|
| S1 occurrences | 3 + 1 = 4 | `logs/S1-demo.log` (OCC1-3), `logs/S1-demo4.log` |
| S1 wall times | 101 s / 50 s / 91 s; demo 4 = 179 s | `NOTES` timeline 23:53-00:03 and 00:21-00:24 |
| S1 active times | 142 s / 52 s / 82 s; median 82 s | `NOTES` timeline 23:53-00:03 |
| S2 occurrences | 3 | `logs/S2-demo.log` |
| S2 move step did not take effect | verified by `ls`, target folders 0 items | `logs/S2-demo.log` DEVIATION line and final verification block |
| S3 first pass: occurrences and durations | 2, 152 s and 109 s | `NOTES` 01:09-01:45; `logs/S3-demo.log` |
| S3 second pass (270 s gaps): occurrences, active durations | 2, 61 s and 60 s | `NOTES` "S6 journal note x3 and S3 repeat x2" |
| S3 merged episode | 42 events, 330 s active | `NOTES` 01:09-01:45 |
| S4 occurrences and renames | 2 occurrences, 4/4 renames | `logs/S4-demo.log` final ls |
| S4 teach range | 6 events over 01:31:42-01:37:42 | `NOTES` 01:09-01:45 |
| S5 occurrences, idle gap | 2, 5 min idle gap | `logs/S5-demo.log` (idle heartbeats 1/10-10/10) |
| S6 occurrences | 3 (J1, J2, J3), interleaved with N1 and N2 | `logs/S6-demo.log`; `NOTES` S6 section |
| Final block schedule | J1, N1, J2, N2, J3, each followed by 270 s of inactivity | `NOTES` S6 section; `logs/S6-demo.log` |
| Final block segmentation | exactly 5 episodes, one per occurrence; active 176 / 61 / 45 / 60 / 135 s | `NOTES` S6 section; `M-S6` -> `learning.episodes` = 5 |
| Total occurrences demonstrated | 4+3+(2+2)+2+2+3 = 20 across 6 routines | sum of the above |
| Routines discovered passively / taught / not proposed | 3 (S1, S5, S6) / 1 (S4) / 2 (S2, S3) | `NOTES` "Learning totals for the night" |

## Learning

| Number | Value | Source |
|---|---|---|
| Episodes over the whole session | 34 | `M-FINAL` -> `learning.episodes` |
| Episodes in the 02:40-onwards window | 5 (median active 61,316 ms) | `M-S6` -> `learning.episodes`, `episodeActiveMedianMs` |
| Median episode active duration | 61436 ms | `M-FINAL` -> `learning.episodeActiveMedianMs` |
| Candidates listed | 9 (8 created during the session; the oldest predates it) | `M-FINAL` -> `learning.candidates` |
| Highest-scoring candidate, 02:25:55 ("Save in TextEdit after opening 'invoice-inv.pdf' in Finder") | repeat 2, similarity 0.9034, confidence 0.8161, median 233,930 ms, 7 steps | `M-FINAL` -> `learning.candidates` |
| That candidate was built from Apprentice's own approved actions in runs 5 and 7 | as stated | session coordinator, confirmed by its 02:25:55 timestamp immediately after run 7 (02:22-02:27) |
| Seventh candidate, 02:39:21 ("Click the 'List view' tree after opening 'img.txt' in Finder") | repeat 2, similarity 0.7117, confidence 0.5866, median 311,822 ms, 4 steps | `M-FINAL` -> `learning.candidates`; timestamp falls inside run 8 (02:35-02:41) and the title names the rename runs' file |
| S1 candidate: repeat / similarity / confidence / median / steps | 4 / 0.7252 / 0.7288 / 169,435 ms / 8 | `M-FINAL` -> `candidates[1]` (`cand_d899bf5d...`) |
| S1 candidate created at | 1788471349656 = 2026-09-04 00:35:49 | same record, `createdAt` |
| S5 candidate: repeat / similarity / confidence / median / steps / variables | 2 / 0.7859 / 0.6474 / 135,488 ms / 14 / 2 | `M-FINAL` -> `candidates[3]` (`cand_255bda0b...`) |
| S5 duplicate candidate similarity / confidence | 0.624 / 0.5122 | `M-FINAL` -> `candidates[2]` (`cand_fd1ac94e...`) |
| Stale episode id on the duplicate | as stated | `NOTES` "S5 weekly roll-up" |
| S6 candidate (03:12:20) | repeat 3, similarity 0.7568, confidence 0.5984, median 134,601 ms, 10 steps, 1 variable | `M-S6` -> `learning.candidates` (last entry); candidate id `cand_2bf3e630fa58d5ec63e7052d` per the session coordinator |
| S6 candidate: minimum pairwise similarity 0.66; 10 steps all at 100 percent occurrence, in the demonstrated order | as stated | `NOTES` S6 section |
| S6 candidate step order (open template.txt, TextEdit, cmd+a, cmd+c, cmd+w, click Notes, cmd+n, cmd+v) | as stated | `NOTES` S6 section |
| S6 spurious variable from a stray click in J1 | `step2_target`, examples back-to-runs / template-txt | `NOTES` S6 section |
| Superseded 2-occurrence S6 candidate (02:59:44) | repeat 2, similarity 0.6622, confidence 0.4642, 13 steps | `M-S6` -> `learning.candidates` |
| S3 second pass not proposed: 61 s and 60 s active, gate needs a median above 90 s | as stated | `NOTES` S6 section |
| Discovery gate (2 episodes, 3 actions, median active > 90 s) | as stated | repo:docs/KNOWN_LIMITATIONS.md "Learning" |
| Active-gap ceiling 60 s -> 120 s | commit `4da5abe` | `NOTES` timeline 00:33; `git log 4da5abe` |
| 4-minute idle threshold | as stated | `NOTES` "S3" and "S5" entries |
| S5 variables at 50 percent occurrence, typed as Date | as stated | `NOTES` "S5 weekly roll-up" and "Run 5" observation |
| Teach skill skeleton, typed text never recorded | privacy invariant 2 | `NOTES` S4 entry; repo:CLAUDE.md invariant 2 |
| Discovery events at 01:54:29 / 01:54:43 / 02:12:10 | log lines 22:54:29Z / 22:54:43Z / 23:12:10Z | `app-night3.log`, `app-night4.log` |

## Runs (real model)

All from `M-FINAL` -> `runs[]`, indices 0-10.

| Number | Value | Source |
|---|---|---|
| Runs recorded | 11 | `runs[]` (length) |
| Steps / proposals / executed / verified | 69 / 65 / 51 / 44 | sums over `runs[]` |
| Invalid (engine refusals) / stale / rejected | 3 / 0 / 0 | sums over `runs[]` |
| Operator subtask advances | 7 | sum of `userAdvanced` |
| Total run wall time | 2,771,878 ms = 46.2 min | sum of `wallMs` |
| Refusal reasons | 2 hit-test (`runs[0]`, "target belongs to com.anthropic.claudefordesktop"), 1 `target_ambiguous` (`runs[8]`) | `runs[].invalid`, `runs[0].summary`, `NOTES` "Run 9" |
| Reviewed-skill runs completed | 3 of 4: invoice 2 of 2 (`runs[4]`, `runs[6]`), journal 1 of 2 (`runs[8]` completed, `runs[10]` interrupted) | `runs[].status`; `NOTES` "Run 11" |
| Unreviewed discovered-skill runs | 0 of 1 (`runs[5]`) | `runs[5].status`; `NOTES` "Run 6" |
| Rename runs | 0 of 3 (`runs[3]`, `runs[7]`, `runs[9]`) | `runs[].status`; `NOTES` "Run 10" |
| Run 5 (`runs[4]`, `run_0mtm50ovmefadfdffd7f42190`) steps / proposed / executed / verified | 8 / 8 / 6 / 5 | `runs[4]` |
| Run 5 wall / propose median / max | 311,214 ms = 5 m 11 s / 11,767 ms / 31,659 ms | `runs[4]` |
| Run 5 propose total / approvals / helper / verify | 125 s / 143 s / 282 ms / 3.5 s | `NOTES` "Run 5" |
| Run 5 helper timings | 145 / 25 / 44 / 13 / 29 / 26 ms | `NOTES` "Run 5" |
| Run 5 ledger line | `2026-08-25 \| Metro Transit \| 66.00 \| invoice-INV-1105.pdf` | `NOTES` "Run 5" |
| Run 7 (`runs[6]`) steps / proposed / executed / verified | 8 / 7 / 6 / 5 | `runs[6]` |
| Run 7 wall / propose median / max | 327,795 ms = 5 m 28 s / 9,346 ms / 29,744 ms | `runs[6]` |
| Run 7 per-proposal latencies | 9.0, 9.3, 9.3, 8.1, 20.3, 23.2, 29.7 s; sum 109 s | `NOTES` "Run 7" |
| Run 7 approvals / helper / verify / capture | 123 s / 268 ms / 4.5 s / 6.4 s | `NOTES` "Run 7" |
| Run 7 ledger line (byte-exact) | `2026-08-26 \| Lumen Electric \| 141.75 \| invoice-INV-1106.pdf` | `NOTES` "Run 7" |
| Run 6 (`runs[5]`) proposed / executed / verified / subtasks | 5 / 4 / 3 / 1 of 3 | `runs[5]` |
| Run 6 wall / propose median | 189,425 ms = 3 m 9 s / 8,328 ms | `runs[5]` |
| Run 8 (`runs[7]`) steps / proposed / executed / verified | 8 / 8 / 6 / 5 | `runs[7]` |
| Run 8 wall / propose median / max | 294,807 ms = 4 m 55 s / 10,492 ms / 26,951 ms | `runs[7]` |
| Run 8 prefix-cache hits vs accumulated screenshots | 3.8-4.5 s on proposals 2-4; 21-27 s later | `NOTES` "Run 8" |
| Run 9 (`runs[8]`, `run_0mtm7mqyc65f9af40434197e9`) steps / proposed / executed / verified | 13 / 12 / 10 / 8 | `runs[8]` |
| Run 9 status / wall / propose median / max | completed, "All subtasks verified" / 500,885 ms = 8 m 21 s / 17,206 ms / 45,247 ms | `runs[8]` |
| Run 9 propose total / approvals / helper / verify / capture | 250 s over 12 proposals (7.0-45.2 s) / 160 s / 0.44 s / 8.4 s / 11.2 s | `NOTES` "Run 9" |
| Run 9 skill provenance | S6 candidate promoted with "Edit and save"; app drafted 3 subtasks with `app_frontmost` predicates; human edited wording, added the title "Journal 2026-09-07", removed a spurious variable; structure and predicates untouched | `NOTES` "Run 9"; session coordinator |
| Run 9 result | a Notes note titled "Journal 2026-09-07" followed by the template text, checked in the Notes window | `NOTES` "Run 9" |
| Run 9 verify-false steps that succeeded | 2 (Command+C, Command+V) | `NOTES` "Run 9" |
| Run 9 low-risk grant | "Approve low-risk for this run" used once, so Command+C ran without a further prompt | `NOTES` "Run 9" |
| Run 10 (`runs[9]`) steps / proposed / executed / verified | 4 / 4 / 3 / 2 | `runs[9]` |
| Run 10 wall / propose median / max | 122,213 ms = 2 m 2 s / 4,514 ms / 10,903 ms | `runs[9]` |
| Run 10 wording and behaviour | macOS-explicit skill (click the name text, wait, Command+A, type, Return); model followed exactly; no rename | `NOTES` "Run 10" |
| Run 10 root cause | the Finder row showed the grey inactive-window selection: every approval brings Apprentice forward, so Finder loses key status before inline rename engages | `NOTES` "Run 10" |
| Run 11 (`runs[10]`) steps / proposed / executed / verified / subtasks | 9 / 8 / 7 / 7 / 2 of 3 | `runs[10]` |
| Run 11 wall / propose median / max | 305,369 ms = 5 m 5 s / 8,139 ms / 19,148 ms | `runs[10]` |
| Run 11 failure mode | model proposed "click the Notes icon in the Dock" three times; engine resolved each to a scroll view in the Notes window and executed two, verified; never reached Command+N | `NOTES` "Run 11"; `runs[10].actions` |
| Run 11 reading | the window-scoped screenshot does not show which app is frontmost, so the model could not tell it had already succeeded | `NOTES` "Run 11" |
| Rename run 4 (`runs[3]`) latency drift 17 -> 60 s, 8,900 re-prefilled tokens | as stated | `NOTES` "Run 4"; `runs[3].proposeMaxMs` = 60,051 ms |

## Grounding benchmark

| Number | Value | Source |
|---|---|---|
| Cases: total / Finder / Preview / TextEdit / Apprentice | 32 / 12 / 12 / 5 / 3 | `grounding/all-cases.json` -> `cases[].app` |
| Roles: Button 14, StaticText 6, Cell 3, PopUp 3, CheckBox 3, MenuButton 2, Radio 1 | as stated | `grounding/all-cases.json` -> `cases[].role` |
| Tolerance | 6 px from the accessibility rect | `G-off.tolerancePx`; `outcomes[].distancePx` |
| Reference pass (`G-clean`, thinking off, temp 0.2, exclusive single-slot server) hits | 19/32 = 59.4 percent | `G-clean.summary.hits`, `hitRate` |
| Reference pass by app | Finder 9/12, Preview 9/12, TextEdit 0/5, Apprentice 1/3 | `G-clean.summary.byApp` |
| Reference pass by role | Cell 3/3, StaticText 4/6, Button 8/14, CheckBox 2/3, PopUp 2/3, MenuButton 0/2, Radio 0/1 | `G-clean.summary.byRole` |
| Reference pass latency median / p90 / min / max | 9.9 s / 11.6 s / 8.6 s / 28.5 s | `G-clean.summary.medianLatencyMs`; `NOTES` clean-pass section |
| Reference pass tokens (prompt / completion, median) | 3,781 / 72 | `G-clean.summary` |
| Reference pass parse failures / action type matches | 0 / 32 of 32 | `G-clean.summary` |
| Reference pass tolerance sweep 6/12/24/48/96 px | 19 / 19 / 19 / 20 / 23 of 32 | computed from `G-clean.outcomes[].distancePx` |
| Reference pass miss distances min / median / max | 30 / 449 / 1,427 px | computed from `G-clean.outcomes` where `hit == false` |
| Reference pass window-chrome traffic lights | 1 of 6 (apprentice-3 at 3.6 px; the other five miss by 30 to 1,427 px) | `G-clean.outcomes` |
| Accuracy range across the four passes | 47 to 59 percent | `G-on10`, `G-off`, `G-on02`, `G-clean` summaries |
| Earlier thinking-off pass, temp 0.2: hits | 17/32 = 53.1 percent | `G-off.summary.hits`, `hitRate` |
| Earlier thinking-off pass by app | Finder 9/12, Preview 8/12, TextEdit 0/5, Apprentice 0/3 | `G-off.summary.byApp` |
| Earlier thinking-off pass latency | 13,919 ms median, measured under server contention, not reported | `G-off.summary.medianLatencyMs`; `NOTES` "Run 4" |
| Earlier thinking-off pass completion tokens median | 71 | `G-off.summary.medianCompletionTokens` |
| Thinking on, temp 1.0: hits | 15/32 = 46.9 percent | `G-on10.summary` |
| Thinking on temp 1.0 by app | Finder 9/12, Preview 6/12, TextEdit 0/5, Apprentice 0/3 | `G-on10.summary.byApp` |
| Thinking on temp 1.0 latency median | 15,495 ms | `G-on10.summary.medianLatencyMs` |
| Thinking on temp 1.0 latency min / p25 / p75 / p90 / max | 9.7 / 12.7 / 17.7 / 28.2 / 81.8 s | computed from `G-on10.outcomes[].latencyMs` |
| Thinking on temp 1.0 completion tokens median | 173 | `G-on10.summary.medianCompletionTokens` |
| Thinking on, temp 0.2: hits | 18/32 = 56.3 percent | `G-on02.summary` |
| Thinking on temp 0.2 by app | Finder 9/12, Preview 7/12, TextEdit 1/5, Apprentice 1/3 | `G-on02.summary.byApp` |
| Thinking on temp 0.2 completion tokens median | 163 | `G-on02.summary.medianCompletionTokens` |
| Parse failures (all four passes) | 0 | `summary.parseFailures` in all four reports |
| Action type matched | 32/32 in the reference pass, 31/32 in the other three | `summary.actionTypeMatches` |
| Prompt tokens median | 3,781 (off) / 3,779 (on) | `summary.medianPromptTokens` |
| Window-chrome traffic lights across the four passes | 1/6 clean, 0/6 `G-off`, 0/6 `G-on10`, 2/6 `G-on02` (cases textedit-1/4/5, apprentice-1/2/3) | `outcomes[].hit` in each report |
| TextEdit case mix: 4 chrome controls + 1 title | textedit-1 close, -2 document actions, -3 ledger.txt, -4 full screen, -5 minimise | `grounding/all-cases.json` |
| Prefill 220-400 tok/s, generation about 32 tok/s | as stated | repo:docs/MODEL_PERFORMANCE.md "Per-step latency" |
| Image tokens about 1,800 for a window capture | 1,798 | repo:docs/MODEL_PERFORMANCE.md "Per-step latency" |

## Resource use

| Number | Value | Source |
|---|---|---|
| GPU memory in use during runs | 11.2-11.7 GB | repo:docs/MODEL_PERFORMANCE.md "Guided runs in the packaged app" |
| llama-server RSS during runs | 8.9-9.8 GB | same |
| Apprentice main process / helper memory | 150-170 MB / 26-60 MB | same |
| Free system memory | above 25 percent | same |
| Memory verdicts by size (36 / 32 / 24 / 16 GB) | as stated | repo:docs/MODEL_PERFORMANCE.md "Realistic hardware requirements" |

## Commits referenced

| Commit | Subject | Source |
|---|---|---|
| `4da5abe` | count reading pauses of up to two minutes as active work | `git log` |
| `656aa88` | end a subtask from the run engine and the UI, not only the model | `git log` |
| `778dba3` | honour a subtask advance while a focus or window question is pending | `git log` |
| `f2c54cb` | window-scoped capture by default; never persist a display fallback | `git log` |
| `ce9d4c9` | honour finish_reason, explicit terminal tokens, macOS prompt, quit denylist | `git log` |
| `b69fbb4` | single llama-server slot and thinking off for the managed runtime | `git log` |
| `8d237cb`, `f69432f` | offline GUI-grounding accuracy benchmark and its settings plumbing | `git log` |

## Discrepancies and exclusions, recorded for the reviewer

1. `REPORT-NOTES.md` records the thinking-on temperature-0.2 pass as "16/32 = 50 percent,
   median latency 14.3 s, 1 parse failure, median 150 completion tokens". The report JSON now on
   disk (`G-on02`, generated 2026-09-03T23:01:47Z) records 18/32, median 32.4 s, 0 parse
   failures, 163 completion tokens. The JSON is the machine artifact and is what this report
   uses; the notes appear to describe an earlier pass whose report file was overwritten by the
   02:01 rerun. Both are stated here so the difference is visible.
2. The latency of the thinking-on temperature-0.2 pass is not reported. Its 32.4 s median was
   measured while a second benchmark shared the same server (`NOTES`, "Run 4"). Accuracy is
   unaffected by contention and is reported.
3. `G-on10`'s internal `label` field reads "thinking on temp0.2 (managed runtime)" and the file
   carries no `temperature` field. `REPORT-NOTES.md` states this pass ran at the provider default
   of 1.0. The notes are used for that label.
4. Run 5: `NOTES` says all six executed actions were verified; `M-FINAL` records `executed: 6`,
   `verified: 5`. The metrics field is used. The same holds for run 7, where `NOTES` names the
   unverified action (Command+S) explicitly.
5. Runs 5 and 7 both read `subtasks: "2/3"` in the metrics export while their status is
   `completed` with summary "All subtasks verified"; the third subtask was closed by the operator
   confirmation recorded in `NOTES`. Both are stated in the report.
6. Run 7 wall time: `M-FINAL` records 327,795 ms (5 m 28 s). `NOTES` says "4m04s wall clock",
   which is the sum of the measured phases (109 + 123 + 0.27 + 4.5 + 6.4 = 243 s) rather than the
   run's wall clock. The metrics field is used for wall time; the phase figures are used as
   phases.
7. Per-step wall-clock timestamps are not exported, so the run-composition chart shows the
   measured phase totals, not wall-clock positions. This is stated on the chart.
8. S6 was never demonstrated; no figure is reported for it.
9. The oldest candidate (`cand_5af37a2d...`, created 2026-09-03 14:08) predates this session and is
   excluded from every count; the eight created between 00:35 and 03:12 are the ones discussed, two
   of them built from the assistant's own run actions and one a superseded S6 predecessor.
10. Intermediate exports taken during the session were superseded by the final export
    (`validation-runs-2026-09-04.json`), which is the source for every run and learning figure.
11. The reference grounding pass p90 is reported as 11.6 s, the value recorded in `NOTES`. A
    nearest-rank percentile over `G-clean.outcomes` gives 11.8 s and linear interpolation gives
    11.76 s; the difference is a percentile-method choice, not a data difference.
12. Run 8 wall time: `M-FINAL` records 294,807 ms (4 m 55 s); `NOTES` says the tester stopped it
    after 4 m 36 s. The metrics field is used, as for every other run.
13. Run 8 executed count: `NOTES` says "7 approved, all executed and 6 verified"; `M-FINAL` records
    `executed: 6`, `verified: 5`. The difference is the approved `wait` action, which is not a
    helper execution. The metrics fields are used for the totals and the prose says "7 approved
    (one a wait), 6 executed".
14. The 979 + 99 test-suite figure was dropped from the report. The only full-suite output produced
    tonight (`merge1-test.log`, 00:15) predates commits `778dba3`, `b69fbb4` and `f69432f`, so it
    does not support a claim about the tree as it stood at the end of the session.
15. Episode counts: `M-FINAL` records 34 episodes over the whole 23:40-onwards window; `M-S6`'s
    narrower 02:40-onwards window shows that the final five demonstrations produced exactly five of
    them, one per occurrence, which is the point the report makes.
16. Run 11 wall time: `M-FINAL` records 305,369 ms (5 m 5 s); `NOTES` says 4 m 35 s. Run 10:
    `M-FINAL` records 122,213 ms (2 m 2 s); the coordinator described it as about 2 minutes. The
    metrics field is used in both cases, as for every other run.
17. Run 9 and run 11 both read `subtasks: "2/3"` in the export; run 9's status is `completed` with
    summary "All subtasks verified" (the third subtask closed by the operator confirmation recorded
    in `NOTES`), run 11's is `interrupted`.
18. Latency is reported only for the reference pass and for `G-on10`. The earlier thinking-off
    pass and the thinking-on temperature-0.2 pass shared the model server with a second benchmark,
    which inflates their latency; their accuracy is reported and is unaffected.
