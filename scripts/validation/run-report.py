"""Overnight validation helper: prints the latest run with per-step timings.

Shows per-step capture/propose/approval/execute/verify timings for one run, used
while following a run during the manual validation protocol described in
scripts/validation/README.md.

Usage:
    python3 scripts/validation/run-report.py [run_id]

    With no run_id, reports the most recently started run.

Environment:
    APPRENTICE_DB_PATH   path to the app database
                          (default: ~/Library/Application Support/Apprentice/apprentice.sqlite)
"""
import json, sqlite3, sys, os
db = os.path.expanduser(os.environ.get("APPRENTICE_DB_PATH", "~/Library/Application Support/Apprentice/apprentice.sqlite"))
con = sqlite3.connect(db)
run_id = sys.argv[1] if len(sys.argv) > 1 else con.execute("select id from runs order by started_at desc limit 1").fetchone()[0]
run = json.loads(con.execute("select json from runs where id=?", (run_id,)).fetchone()[0])
print(f"run {run['id']} skill={run['skillName']!r} mode={run['mode']} status={run['status']} provider={run.get('provider')}/{run.get('model')} failure={run.get('failureCategory')} subtask {run['currentSubtaskIndex']}/{run['subtaskCount']}")
print(f"  started {run['startedAt']} ended {run.get('endedAt')} total {(run.get('endedAt') or 0) - run['startedAt']} ms metrics={run['metrics']}")
print(f"  summary: {run.get('summary')}")
tot = {}
for (js,) in con.execute("select json from run_steps where run_id=? order by idx", (run_id,)):
    s = json.loads(js); t = s['timing']
    for k, v in t.items(): tot[k] = tot.get(k, 0) + v
    p = s.get('proposed') or {}
    v = s.get('verification') or {}
    print(f"  step {s['index']} sub {s['subtaskIndex']} {p.get('type') or s.get('controlToken') or '-':16} capture {t['captureMs']:5} propose {t['proposeMs']:6} approval {t['approvalWaitMs']:6} exec {t['executeMs']:4} verify {t['verifyMs']:5} total {t['totalMs']:6} | {s.get('failureCategory')} | {s.get('actionSummary','')[:70]} | verify={v.get('passed')} {v.get('method','')}")
print("  totals:", tot)
