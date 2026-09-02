import type { JSX } from "react";
import type { ActivityEvent, ScreenshotRecord } from "@apprentice/schemas";
import { RangeSlider, type RangeTick } from "../../components/RangeSlider";
import { TextInput } from "../../components/Field";
import { fromDatetimeLocal, toDatetimeLocal } from "../../lib/format";
import { setHandle, type TimeRange } from "../../lib/range-math";

interface RangeEditorProps {
  bounds: TimeRange;
  value: TimeRange;
  onChange: (next: TimeRange) => void;
  events: ReadonlyArray<ActivityEvent>;
  screenshots: ReadonlyArray<ScreenshotRecord>;
  excluded: ReadonlySet<string>;
}

/** Draggable start/end boundaries plus exact time inputs. */
export function RangeEditor({ bounds, value, onChange, events, screenshots, excluded }: RangeEditorProps): JSX.Element {
  const ticks: RangeTick[] = [
    ...events.map((e) => ({ id: e.id, ts: e.ts, kind: (excluded.has(e.id) ? "excluded" : "event") as RangeTick["kind"] })),
    ...screenshots.map((s) => ({ id: `shot-${s.id}`, ts: s.ts, kind: "screenshot" as const }))
  ];
  const setExact = (which: "start" | "end", raw: string): void => {
    const ts = fromDatetimeLocal(raw);
    if (ts === null) return;
    onChange(setHandle(value, which, ts, bounds));
  };
  return (
    <div className="stack">
      <RangeSlider bounds={bounds} value={value} onChange={onChange} ticks={ticks} label="Taught range" />
      <p className="small muted">Drag the handles or focus one and use the arrow keys (Shift for larger steps, Home and End for the edges). Blue ticks are screenshots, grey ticks are events.</p>
      <div className="grid-2">
        <TextInput label="Start" type="datetime-local" step={1} value={toDatetimeLocal(value.startTs)} onValueChange={(v) => setExact("start", v)} min={toDatetimeLocal(bounds.startTs)} max={toDatetimeLocal(bounds.endTs)} />
        <TextInput label="End" type="datetime-local" step={1} value={toDatetimeLocal(value.endTs)} onValueChange={(v) => setExact("end", v)} min={toDatetimeLocal(bounds.startTs)} max={toDatetimeLocal(bounds.endTs)} />
      </div>
    </div>
  );
}
