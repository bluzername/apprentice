import { useEffect, useRef, useState, type FocusEvent, type JSX, type KeyboardEvent } from "react";
import { menuBarStatusLabel, formatTime } from "../lib/format";
import { invoke } from "../lib/api";
import { navigate } from "../lib/router";
import { useStore } from "../state/store";

/**
 * Learning status chip with the quick actions from the menu bar, exposed as a
 * disclosure (button + aria-expanded) over a plain list of buttons.
 */
export function StatusChip(): JSX.Element {
  const { state, setLearning, toast, dispatch, reloadLearning } = useStore();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const learning = state.learning;
  const unknown = state.learningError !== null;
  const status = learning?.menuBarStatus ?? "stopped";

  /** Closes the popover; focus returns to the chip unless the user moved it elsewhere. */
  const close = (returnFocus: boolean): void => {
    restoreFocus.current = returnFocus;
    setOpen(false);
  };

  useEffect(() => {
    if (open || !restoreFocus.current) return;
    restoreFocus.current = false;
    chipRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (anchor.current && !anchor.current.contains(e.target as Node)) {
        restoreFocus.current = false;
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== "Escape" || !open) return;
    e.preventDefault();
    e.stopPropagation();
    close(true);
  };

  const onBlur = (e: FocusEvent<HTMLDivElement>): void => {
    if (!open || !anchor.current) return;
    if (!(e.relatedTarget instanceof Node) || !anchor.current.contains(e.relatedTarget)) close(false);
  };

  const act = async (fn: () => Promise<void>, success: string): Promise<void> => {
    setBusy(true);
    try {
      await fn();
      toast("success", success);
    } catch (err) {
      toast("error", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      close(true);
    }
  };

  const stopModel = async (): Promise<void> => {
    const model = await invoke("model:stopAll");
    dispatch({ type: "model", model });
  };

  const isLearning = learning?.state === "learning";
  const label = unknown ? "Status unknown" : menuBarStatusLabel(status);
  const detail = !unknown && learning?.pausedUntil ? ` until ${formatTime(learning.pausedUntil)}` : "";

  return (
    <div className="menu-anchor row" ref={anchor} onKeyDown={onKeyDown} onBlur={onBlur}>
      <button ref={chipRef} type="button" className={`status-chip status-${unknown ? "unknown" : status}`} aria-expanded={open} aria-controls="learning-actions" onClick={() => (open ? close(true) : setOpen(true))}>
        <span className="status-dot" aria-hidden="true" />
        <span>
          {label}
          {detail}
        </span>
      </button>
      {unknown ? (
        <button type="button" className="btn btn-sm" onClick={() => void reloadLearning()}>
          Retry
        </button>
      ) : null}
      {open ? (
        <div className="menu" id="learning-actions">
          {unknown ? <div className="callout callout-warning small">Could not read the learning status: {state.learningError}</div> : null}
          <ul className="menu-list">
            <li>
              <button type="button" className="menu-item" disabled={busy || !isLearning} onClick={() => void act(() => setLearning("paused", 15), "Paused for 15 minutes")}>
                Pause 15 min
              </button>
            </li>
            <li>
              <button type="button" className="menu-item" disabled={busy || !isLearning} onClick={() => void act(() => setLearning("paused"), "Paused until you resume")}>
                Pause until resumed
              </button>
            </li>
            <li>
              <button type="button" className="menu-item" disabled={busy || learning?.state === "private"} onClick={() => void act(() => setLearning("private"), "Private mode on. Nothing is captured.")}>
                Private mode
              </button>
            </li>
            <li>
              <button type="button" className="menu-item" disabled={busy || isLearning} onClick={() => void act(() => setLearning("learning"), "Learning resumed")}>
                Resume
              </button>
            </li>
          </ul>
          <hr className="menu-separator" />
          <ul className="menu-list">
            <li>
              <button type="button" className="menu-item" onClick={() => { close(true); navigate("teach"); }}>
                Learn what I just did
              </button>
            </li>
          </ul>
          <hr className="menu-separator" />
          <ul className="menu-list">
            <li>
              <button type="button" className="menu-item" disabled={busy} onClick={() => void act(stopModel, "All local model work stopped")}>
                Stop all local model work
              </button>
            </li>
          </ul>
          {busy ? (
            <div className="menu-item" role="status">
              <span className="spinner" aria-hidden="true" /> Working
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
