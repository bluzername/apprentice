# Validation helper scripts

Helper scripts used to reproduce the manual, real-model validation described in
`docs/VALIDATION_REPORT.md`. They set up test fixtures, position windows for a
demonstration, and read the app's SQLite database to follow learning progress
and run execution. Nothing here is part of the shipped app; these are
developer-run tools for alpha validation sessions.

## What they are for

Apprentice learns workflows by watching the user repeat them, then proposes a
skill it can run with approval. Validating that end to end needs a human to
demonstrate a routine a few times in a controlled environment, then watch the
app detect the pattern, promote it to a skill, and execute it under guide mode.
These scripts remove the manual toil around that: generating realistic test
files, arranging windows so a screen recording is legible, and pulling
structured data out of the database instead of reading raw JSON blobs.

## Manual protocol

1. **Create fixtures.**
   ```bash
   python3 scripts/validation/make-fixtures.py
   ```
   Builds a fixture tree under `~/Desktop/Apprentice-test-work` (invoices,
   receipts, vendor folders, weekly notes, downloads, a journal template).
   Idempotent and safe to re-run before each session.

2. **Launch the packaged app with observation on.** Enable the allowlisted
   apps and folders used by the fixtures (Finder, Preview, TextEdit, Notes,
   and the `Apprentice-test-work` paths). Do not enable capture for anything
   outside the fixture tree.

3. **Position the demonstration windows.**
   ```bash
   scripts/validation/layout.sh Invoices
   ```
   Run before each occurrence so the relevant Finder window, TextEdit, Preview,
   and Notes are laid out consistently and stay clear of the screen-center
   system dialog. Pass the Finder window name for the scenario being
   demonstrated (for example `Receipts-Inbox`).

4. **Demonstrate a routine 3 to 4 times.** Perform the same workflow by hand
   (for example: open an invoice, read the total, log it in a ledger) with a
   4 to 5 minute idle gap between occurrences so the app's episode
   segmentation treats them as distinct sessions. Optionally keep
   `preview-watcher.sh` running in the background during a run so Preview
   windows do not drift into the system dialog slot:
   ```bash
   scripts/validation/preview-watcher.sh 1800
   ```

5. **Wait for a candidate.** After 3 to 4 occurrences, check the app's
   Candidates view for a detected pattern. Use `metrics.py` or
   `export-state.py` (below) if you want to confirm detection from the
   database instead of the UI.

6. **Promote the candidate to a skill** from the app UI once its title,
   steps, and variables look right.

7. **Run the skill in guide mode.** Start a run and follow it live:
   ```bash
   scripts/validation/wait-approval.sh 180
   ```
   Blocks until the run needs attention (awaiting approval, awaiting user
   input, or a pending step) or ends, then returns. Re-run it in a loop to
   step through a multi-step run.
   ```bash
   python3 scripts/validation/run-report.py
   ```
   Prints the latest run with per-step capture, propose, approval, execute,
   and verify timings, and the overall status and failure category. Pass a
   run id to inspect a specific run instead of the latest one.

8. **Export metrics or full state** for the validation report:
   ```bash
   python3 scripts/validation/metrics.py <since_epoch_ms> [out.json]
   python3 scripts/validation/export-state.py [since_epoch_ms] [out.json]
   ```

## Script reference

| Script | Usage | Purpose |
|---|---|---|
| `make-fixtures.py` | `python3 make-fixtures.py` | Creates the fixture tree under `~/Desktop/Apprentice-test-work` (or `$APPRENTICE_FIXTURES_ROOT`). |
| `layout.sh` | `layout.sh [FinderWindowName]` | Positions Finder, TextEdit, Preview, and Notes windows for a demonstration. |
| `preview-watcher.sh` | `preview-watcher.sh [duration_s]` | Keeps Preview windows out of the screen-center dialog slot while a run executes. |
| `wait-approval.sh` | `wait-approval.sh <timeout_s>` | Polls the database until the latest run needs attention or ends. |
| `run-report.py` | `python3 run-report.py [run_id]` | Prints a run's per-step timings; defaults to the latest run. |
| `metrics.py` | `python3 metrics.py <since_epoch_ms> [out.json]` | Prints run and learning metrics as markdown, optionally also as JSON. |
| `export-state.py` | `python3 export-state.py [since_epoch_ms] [out.json]` | Dumps runs, steps, candidates, and skills as JSON. |

## Environment variables

- `APPRENTICE_DB_PATH` - path to the app database. Defaults to
  `~/Library/Application Support/Apprentice/apprentice.sqlite`. Used by
  `metrics.py`, `export-state.py`, `run-report.py`, and `wait-approval.sh`.
- `APPRENTICE_FIXTURES_ROOT` - path to the fixture tree. Defaults to
  `~/Desktop/Apprentice-test-work`. Used by `make-fixtures.py`.

## Notes

- These scripts read the app's local SQLite database directly; they do not
  call any app IPC and do not require the app to be running except to have
  produced the data being read.
- `layout.sh` and `preview-watcher.sh` use AppleScript through `osascript`
  and require Accessibility permission for the terminal or app running them.
- None of these scripts touch files outside the fixture tree or the app's own
  database.
