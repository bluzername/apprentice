#!/bin/zsh
# Overnight validation helper: keeps Preview windows out of the screen-center dialog slot.
#
# Keeps every non-minimized Preview window at the bottom-left slot while runs
# execute (the system dialog sits at screen center). Run alongside a run during
# the manual validation protocol described in scripts/validation/README.md.
#
# Usage: preview-watcher.sh [duration_s]  (default 1800)
end=$(( $(date +%s) + ${1:-1800} ))
while [ $(date +%s) -lt $end ]; do
  osascript -e 'tell application "System Events" to tell process "Preview" to repeat with w in windows
    try
      if value of attribute "AXMinimized" of w is false then
        if position of w is not {530, 540} then set position of w to {530, 540}
        if size of w is not {470, 540} then set size of w to {470, 540}
      end if
    end try
  end repeat' >/dev/null 2>&1
  sleep 0.4
done
