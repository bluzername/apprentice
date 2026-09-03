#!/bin/zsh
# Overnight validation helper: positions the fixture windows for a demonstration.
#
# Places the named Finder window top-right and raises it; parks every other Finder
# window bottom-left behind Preview. TextEdit bottom-right, Preview bottom-left,
# Notes top-left. Keeps everything away from the screen-center system dialog. Run
# before each demonstration occurrence, as described in scripts/validation/README.md.
#
# Usage: layout.sh [FinderWindowName]  (default Invoices)
NAME=${1:-Invoices}
osascript - "$NAME" <<'AS'
on run argv
  set wanted to item 1 of argv
  tell application "System Events"
    if exists process "Finder" then
      tell process "Finder"
        repeat with w in windows
          try
            if name of w is wanted then
              set position of w to {1010, 60}
              set size of w to {700, 480}
            else
              set position of w to {10, 600}
              set size of w to {500, 480}
            end if
          end try
        end repeat
        try
          perform action "AXRaise" of window wanted
        end try
      end tell
    end if
    if exists process "TextEdit" then
      tell process "TextEdit"
        repeat with w in windows
          try
            set position of w to {1010, 580}
            set size of w to {700, 480}
          end try
        end repeat
      end tell
    end if
    if exists process "Preview" then
      tell process "Preview"
        repeat with w in windows
          try
            if value of attribute "AXMinimized" of w is false then
              set position of w to {530, 540}
              set size of w to {470, 540}
            end if
          end try
        end repeat
      end tell
    end if
    if exists process "Notes" then
      tell process "Notes"
        repeat with w in windows
          try
            set position of w to {10, 40}
            set size of w to {510, 500}
          end try
        end repeat
      end tell
    end if
    if exists process "Claude" then
      tell process "Claude"
        repeat with w in windows
          try
            set sz to size of w
            if (item 1 of sz) >= 1700 then
              set position of w to {0, 0}
            else if (item 1 of sz) > 100 then
              set position of w to {10, 560}
              set size of w to {515, 540}
            end if
          end try
        end repeat
      end tell
    end if
  end tell
end run
AS
echo "layout applied for Finder window '$NAME'"
