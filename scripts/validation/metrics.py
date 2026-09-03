"""Overnight validation helper: learning and execution metrics, as markdown + JSON.

Exports episodes, candidates, skills, runs and per-step timings from the app's
SQLite database since a given timestamp. Used to check learning progress and run
quality during the manual validation protocol described in scripts/validation/README.md.

Usage:
    python3 scripts/validation/metrics.py <since_epoch_ms> [out.json]

Environment:
    APPRENTICE_DB_PATH   path to the app database
                          (default: ~/Library/Application Support/Apprentice/apprentice.sqlite)
"""
import json, sqlite3, os, sys, statistics as st
db = os.path.expanduser(os.environ.get("APPRENTICE_DB_PATH", "~/Library/Application Support/Apprentice/apprentice.sqlite"))
con = sqlite3.connect(db)
since = int(sys.argv[1]) if len(sys.argv) > 1 else 0

def runs():
    out = []
    for (rid, js) in con.execute("select id, json from runs where started_at >= ? order by started_at", (since,)):
        r = json.loads(js)
        steps = [json.loads(s) for (s,) in con.execute("select json from run_steps where run_id=? order by idx", (rid,))]
        proposed = [s for s in steps if s.get("proposed") or s.get("controlToken")]
        executed = [s for s in steps if s.get("executed")]
        verified = [s for s in executed if (s.get("verification") or {}).get("passed")]
        invalid = [s for s in steps if s.get("failureCategory") in ("invalid_action", "target_ambiguous")]
        stale = [s for s in steps if s.get("failureCategory") == "stale_screen"]
        rejected = [s for s in steps if s.get("failureCategory") == "user_rejected"]
        user_adv = [s for s in steps if (s.get("verification") or {}).get("method") == "user_confirmation"]
        lat = [s["timing"]["proposeMs"] for s in steps if s.get("timing", {}).get("proposeMs", 0) > 0]
        appr = [s["timing"]["approvalWaitMs"] for s in steps if s.get("timing", {}).get("approvalWaitMs", 0) > 0]
        out.append({
            "id": r["id"], "skill": r.get("skillName"), "status": r.get("status"), "failure": r.get("failureCategory"),
            "provider": r.get("provider"), "subtasks": f'{r.get("currentSubtaskIndex")}/{r.get("subtaskCount")}',
            "steps": len(steps), "proposed": len(proposed), "executed": len(executed), "verified": len(verified),
            "invalid": len(invalid), "stale": len(stale), "rejected": len(rejected), "userAdvanced": len(user_adv),
            "proposeMedianMs": int(st.median(lat)) if lat else None, "proposeMaxMs": max(lat) if lat else None,
            "approvalMedianMs": int(st.median(appr)) if appr else None,
            "wallMs": (r.get("endedAt") or 0) - r["startedAt"] if r.get("endedAt") else None,
            "summary": (r.get("summary") or "")[:120],
            "actions": [f'{(s.get("proposed") or {}).get("type") or s.get("controlToken")}: {(s.get("actionSummary") or "")[:70]} [{s.get("failureCategory")}]' for s in steps],
        })
    return out

def learning():
    cands = [json.loads(js) for (js,) in con.execute("select json from candidates")]
    skills = [json.loads(js) for (js,) in con.execute("select json from skills")]
    eps = [json.loads(js) for (js,) in con.execute("select json from episodes where start_ts >= ?", (since,))]
    return {
        "episodes": len(eps),
        "episodeActiveMedianMs": int(st.median([e.get("activeDurationMs", 0) for e in eps])) if eps else None,
        "candidates": [{"id": c["id"], "title": c.get("deterministicTitle"), "repeat": c.get("repeatCount"), "similarity": (c.get("similarity") or {}).get("meanPairwise"), "confidence": c.get("confidence"), "medianDurationMs": c.get("medianDurationMs"), "steps": len(c.get("steps", [])), "variables": len(c.get("variables", [])), "risk": c.get("riskClass"), "createdAt": c.get("createdAt")} for c in cands],
        "skills": [{"id": s["id"], "name": s.get("name"), "source": s.get("source"), "subtasks": [t.get("title") for t in s.get("subtasks", [])], "predicates": [[p.get("kind") for p in t.get("completionPredicates", [])] for t in s.get("subtasks", [])], "version": s.get("version")} for s in skills],
    }

data = {"since": since, "runs": runs(), "learning": learning()}
if len(sys.argv) > 2:
    json.dump(data, open(sys.argv[2], "w"), indent=1)
print("## Runs")
print("| run | skill | status | subtasks | steps | executed | verified | invalid | stale | rejected | user adv | propose median s | wall s |")
print("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
for r in data["runs"]:
    print(f'| {r["id"][-6:]} | {r["skill"]} | {r["status"]} ({r["failure"]}) | {r["subtasks"]} | {r["steps"]} | {r["executed"]} | {r["verified"]} | {r["invalid"]} | {r["stale"]} | {r["rejected"]} | {r["userAdvanced"]} | {(r["proposeMedianMs"] or 0)/1000:.1f} | {(r["wallMs"] or 0)/1000:.0f} |')
print("\n## Learning")
print(json.dumps(data["learning"], indent=1)[:3000])
