#!/bin/zsh
# Overnight validation helper: polls the app database until a run needs attention.
#
# Blocks until the latest run reaches awaiting_approval / awaiting_user, has a
# pending step, or ends, then exits. Used while following a run during the
# manual validation protocol described in scripts/validation/README.md.
#
# Usage: wait-approval.sh <timeout_s>
#
# Environment:
#   APPRENTICE_DB_PATH   path to the app database
#                         (default: ~/Library/Application Support/Apprentice/apprentice.sqlite)
DB="${APPRENTICE_DB_PATH:-$HOME/Library/Application Support/Apprentice/apprentice.sqlite}"
start=$(date +%s)
while true; do
  st=$(sqlite3 "$DB" "select status from runs order by started_at desc limit 1")
  pending=$(sqlite3 "$DB" "select count(*) from run_steps where run_id=(select id from runs order by started_at desc limit 1) and json like '%\"failureCategory\":\"none\"%' and json like '%\"approval\":null%' and json like '%\"executed\":null%' and json not like '%\"controlToken\":\"SUBTASK_COMPLETE\"%' and json like '%\"verification\":null%'")
  if [ "$st" != "running" ] && [ "$st" != "awaiting_approval" ] && [ "$st" != "awaiting_user" ]; then echo "run ended: $st"; break; fi
  if [ "$st" = "awaiting_approval" ] || [ "$st" = "awaiting_user" ] || [ "$pending" -ge 1 ]; then echo "attention: $st pending=$pending"; break; fi
  if [ $(( $(date +%s) - start )) -gt ${1:-180} ]; then echo "timeout ($st)"; break; fi
  sleep 2
done
echo "waited $(( $(date +%s) - start )) s"
