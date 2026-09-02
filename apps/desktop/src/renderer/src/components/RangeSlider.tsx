import { useCallback, useRef, type JSX, type ReactNode } from "react";
import { keyboardStepMs, moveHandle, pointerToTs, setHandle, tsToFraction, type HandleKind, type TimeRange } from "../lib/range-math";
import { formatTimeWithSeconds } from "../lib/format";

export interface RangeTick {
  id: string;
  ts: number;
  kind?: "event" | "screenshot" | "excluded";
}

interface RangeSliderProps {
  bounds: TimeRange;
  value: TimeRange;
  onChange: (next: TimeRange) => void;
  ticks?: ReadonlyArray<RangeTick>;
  minSpanMs?: number;
  label?: string;
  children?: ReactNode;
}

/** Two-handle range over a time axis. Pointer drag plus full keyboard control. */
export function RangeSlider({ bounds, value, onChange, ticks = [], minSpanMs, label = "Time range", children }: RangeSliderProps): JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null);

  const startDrag = useCallback(
    (which: HandleKind) => (e: React.PointerEvent<HTMLButtonElement>) => {
      const track = trackRef.current;
      if (!track) return;
      e.preventDefault();
      const target = e.currentTarget;
      // preventDefault suppresses the browser's pointerdown focus, so focus explicitly:
      // keyboard adjustments must continue from the handle that was just grabbed.
      target.focus();
      target.setPointerCapture(e.pointerId);
      const rect = track.getBoundingClientRect();
      const onMove = (ev: PointerEvent): void => {
        const ts = pointerToTs(ev.clientX, rect.left, rect.width, bounds);
        onChange(setHandle(value, which, ts, bounds, minSpanMs));
      };
      const onUp = (): void => {
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
        target.removeEventListener("pointercancel", onUp);
      };
      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
      target.addEventListener("pointercancel", onUp);
    },
    [bounds, minSpanMs, onChange, value]
  );

  const onKey = (which: HandleKind) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const step = keyboardStepMs(bounds, e.shiftKey);
    let next: TimeRange | null = null;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = moveHandle(value, which, -step, bounds, minSpanMs);
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") next = moveHandle(value, which, step, bounds, minSpanMs);
    else if (e.key === "Home") next = setHandle(value, which, bounds.startTs, bounds, minSpanMs);
    else if (e.key === "End") next = setHandle(value, which, bounds.endTs, bounds, minSpanMs);
    if (next) {
      e.preventDefault();
      onChange(next);
    }
  };

  const left = tsToFraction(value.startTs, bounds) * 100;
  const right = tsToFraction(value.endTs, bounds) * 100;

  const handle = (which: HandleKind, ts: number, pct: number): JSX.Element => (
    <button
      type="button"
      className="range-handle"
      style={{ left: `${pct}%` }}
      role="slider"
      aria-label={which === "start" ? `${label} start` : `${label} end`}
      aria-valuemin={bounds.startTs}
      aria-valuemax={bounds.endTs}
      aria-valuenow={ts}
      aria-valuetext={formatTimeWithSeconds(ts)}
      onPointerDown={startDrag(which)}
      onKeyDown={onKey(which)}
    >
      <span className="range-handle-label" aria-hidden="true">
        {formatTimeWithSeconds(ts)}
      </span>
    </button>
  );

  return (
    <div className="range-editor">
      <div className="range-track" ref={trackRef}>
        <div className="range-selection" style={{ left: `${left}%`, width: `${Math.max(0, right - left)}%` }} aria-hidden="true" />
        {ticks.map((t) => (
          <span
            key={t.id}
            className={`range-tick ${t.kind === "screenshot" ? "shot-tick" : t.kind === "excluded" ? "excluded" : ""}`.trim()}
            style={{ left: `${tsToFraction(t.ts, bounds) * 100}%` }}
            aria-hidden="true"
          />
        ))}
        {handle("start", value.startTs, left)}
        {handle("end", value.endTs, right)}
      </div>
      {children}
    </div>
  );
}
