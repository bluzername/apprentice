import type { JSX, ReactNode } from "react";
import { formatTimeWithSeconds } from "../lib/format";

export interface TimelineEntry {
  id: string;
  ts: number;
  gap?: string;
  selected?: boolean;
  leading?: ReactNode;
  body?: ReactNode;
}

export interface TimelineGroup {
  key: string;
  title: string;
  entries: ReadonlyArray<TimelineEntry>;
}

interface TimelineProps {
  groups: ReadonlyArray<TimelineGroup>;
  label: string;
}

export function Timeline({ groups, label }: TimelineProps): JSX.Element {
  return (
    <section aria-label={label}>
      {groups.map((group) => (
        <section key={group.key} className="timeline-group" aria-label={group.title}>
          <h4 className="timeline-group-title">{group.title}</h4>
          <ol className="timeline">
            {group.entries.map((entry) =>
              entry.gap ? (
                <li key={entry.id} className="timeline-item">
                  <div className="timeline-gap">
                    <span className="mono small">{formatTimeWithSeconds(entry.ts)}</span>
                    <span>{entry.gap}</span>
                  </div>
                </li>
              ) : (
                <li key={entry.id} className={`timeline-item ${entry.selected ? "selected" : ""}`.trim()}>
                  <div>{entry.leading}</div>
                  <time className="timeline-time" dateTime={new Date(entry.ts).toISOString()}>
                    {formatTimeWithSeconds(entry.ts)}
                  </time>
                  <div className="timeline-body">{entry.body}</div>
                </li>
              )
            )}
          </ol>
        </section>
      ))}
    </section>
  );
}
