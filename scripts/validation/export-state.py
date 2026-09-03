"""Overnight validation helper: dumps runs, run steps, candidates and skills as JSON.

Used to capture a full snapshot of the app's learning state for the manual
validation protocol described in scripts/validation/README.md.

Usage:
    python3 scripts/validation/export-state.py [since_epoch_ms] [out.json]

Environment:
    APPRENTICE_DB_PATH   path to the app database
                          (default: ~/Library/Application Support/Apprentice/apprentice.sqlite)
"""
import json, sqlite3, os, sys, time
db = os.path.expanduser(os.environ.get("APPRENTICE_DB_PATH", "~/Library/Application Support/Apprentice/apprentice.sqlite"))
con = sqlite3.connect(db)
since = int(sys.argv[1]) if len(sys.argv) > 1 else 0
out = {"exportedAt": int(time.time()*1000), "runs": [], "candidates": [], "skills": []}
for (rid, js) in con.execute("select id, json from runs where started_at >= ? order by started_at", (since,)):
    run = json.loads(js)
    steps = [json.loads(s) for (s,) in con.execute("select json from run_steps where run_id=? order by idx", (rid,))]
    run["steps"] = steps
    out["runs"].append(run)
for (js,) in con.execute("select json from candidates"):
    out["candidates"].append(json.loads(js))
for (js,) in con.execute("select json from skills"):
    out["skills"].append(json.loads(js))
counts = {t: con.execute(f"select count(*) from {t}").fetchone()[0] for t in ["events", "screenshots", "ocr", "episodes", "candidates", "skills", "runs", "run_steps"]}
out["counts"] = counts
path = sys.argv[2] if len(sys.argv) > 2 else "/dev/stdout"
json.dump(out, open(path, "w"), indent=1)
print(json.dumps(counts), "runs:", len(out["runs"]), "candidates:", len(out["candidates"]), "skills:", len(out["skills"]), file=sys.stderr)
