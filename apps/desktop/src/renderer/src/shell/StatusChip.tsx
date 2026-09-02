import { useEffect, useRef, useState, type JSX } from "react";
import { menuBarStatusLabel, formatTime } from "../lib/format";
import { invoke } from "../lib/api";
import { navigate } from "../lib/router";
import { useStore } from "../state/store";

/** Learning status chip with the quick actions from the menu bar. */
export function StatusChip(): JSX.Element {
  const { state, setLearning, toast, dispatch } = useStore();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const learning = state.learning;
  const status = learning?.menuBarStatus ?? "stopped";

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (anchor.current && !anchor.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const act = async (fn: () => Promise<void>, success: string): Promise<void> => {
    setBusy(true);
    try {
      await fn();
      toast("success", success);
    } catch (err) {
      toast("error", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  const stopModel = async (): Promise<void> => {
    const model = await invoke("model:stopAll");
    dispatch({ type: "model", model });
  };

  const isLearning = learning?.state === "learning";
  const label = menuBarStatusLabel(status);
  const detail = learning?.pausedUntil ? ` until ${formatTime(learning.pausedUntil)}` : "";

  return (
    <div className="menu-anchor" ref={anchor}>
      <button type="button" className={`status-chip status-${status}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="status-dot" aria-hidden="true" />
        <span>
          {label}
          {detail}
        </span>
      </button>
      {open ? (
        <div className="menu" role="menu" aria-label="Learning actions">
          <button type="button" role="menuitem" className="menu-item" disabled={busy || !isLearning} onClick={() => void act(() => setLearning("paused", 15), "Paused for 15 minutes")}>
            Pause 15 min
          </button>
          <button type="button" role="menuitem" className="menu-item" disabled={busy || !isLearning} onClick={() => void act(() => setLearning("paused"), "Paused until you resume")}>
            Pause until resumed
          </button>
          <button type="button" role="menuitem" className="menu-item" disabled={busy || learning?.state === "private"} onClick={() => void act(() => setLearning("private"), "Private mode on. Nothing is captured.")}>
            Private mode
          </button>
          <button type="button" role="menuitem" className="menu-item" disabled={busy || isLearning} onClick={() => void act(() => setLearning("learning"), "Learning resumed")}>
            Resume
          </button>
          <div className="menu-separator" role="separator" />
          <button type="button" role="menuitem" className="menu-item" onClick={() => { setOpen(false); navigate("teach"); }}>
            Learn what I just did
          </button>
          <div className="menu-separator" role="separator" />
          <button type="button" role="menuitem" className="menu-item" disabled={busy} onClick={() => void act(stopModel, "All local model work stopped")}>
            Stop all local model work
          </button>
          {busy ? (
            <div className="menu-item" aria-live="polite">
              <span className="spinner" aria-hidden="true" /> Working
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
