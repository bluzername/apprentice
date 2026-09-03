import { useCallback, useMemo, useState, type JSX } from "react";
import type { ActivityEvent, ScreenshotRecord } from "@apprentice/schemas";
import { Button } from "../components/Button";
import { ConfirmDialog } from "../components/Dialog";
import { Select, TextInput } from "../components/Field";
import { CardSkeleton } from "../components/Skeleton";
import { EmptyState, ErrorState } from "../components/States";
import { Timeline, type TimelineEntry, type TimelineGroup } from "../components/Timeline";
import { activityItems, mergeEvents, mergeScreenshots, type ActivityItem } from "../lib/activity-items";
import { invoke } from "../lib/api";
import { formatDate, formatTime, fromDatetimeLocal, hourKey, humanize, pluralize, toDatetimeLocal } from "../lib/format";
import { errorMessage, useIpcEvent, useLoader } from "../lib/hooks";
import { useStore } from "../state/store";
import { EventBody } from "./activity/EventBody";
import { EpisodeDrawer } from "./activity/EpisodeDrawer";
import { ScreenshotBody } from "./activity/ScreenshotBody";

const EVENT_TYPES = ["app_activated", "navigation", "click", "form_submit", "shortcut", "copy", "paste", "download", "privacy_gap", "idle_changed", "teach_marker", "screenshot_captured"] as const;
const DAY = 24 * 60 * 60_000;

interface Selection {
  readonly events: ReadonlySet<string>;
  readonly screenshots: ReadonlySet<string>;
}

const EMPTY_SELECTION: Selection = { events: new Set(), screenshots: new Set() };

function toggled(set: ReadonlySet<string>, id: string, on: boolean): ReadonlySet<string> {
  const next = new Set(set);
  if (on) next.add(id);
  else next.delete(id);
  return next;
}

function describeCounts(events: number, screenshots: number): string {
  return [events > 0 ? pluralize(events, "event") : null, screenshots > 0 ? pluralize(screenshots, "screenshot") : null].filter(Boolean).join(" and ");
}

export function ActivityPage(): JSX.Element {
  const { toast } = useStore();
  const [from, setFrom] = useState(() => toDatetimeLocal(Date.now() - DAY));
  const [to, setTo] = useState(() => toDatetimeLocal(Date.now()));
  const [app, setApp] = useState("");
  const [domain, setDomain] = useState("");
  const [type, setType] = useState("");
  const [limit, setLimit] = useState(500);
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const [confirm, setConfirm] = useState<"selected" | "range" | null>(null);
  const [busy, setBusy] = useState(false);

  const fromTs = fromDatetimeLocal(from);
  const toTs = fromDatetimeLocal(to);
  const rangeError = fromTs === null || toTs === null ? "Enter valid dates." : fromTs >= toTs ? "Start must be before end." : null;

  const loader = useCallback(() => {
    if (fromTs === null || toTs === null || fromTs >= toTs) return Promise.resolve({ events: [] as ActivityEvent[], screenshots: [] as ScreenshotRecord[] });
    return invoke("activity:list", {
      fromTs,
      toTs,
      limit,
      ...(app.trim() ? { app: app.trim() } : {}),
      ...(domain.trim() ? { domain: domain.trim() } : {}),
      ...(type ? { types: [type] } : {})
    });
  }, [fromTs, toTs, limit, app, domain, type]);
  const { data, error, loading, reload, setData } = useLoader(loader);

  useIpcEvent("event:activity", ({ events, screenshots }) => {
    setData((current) => {
      if (!current) return current;
      const inRange = events.filter((e) => toTs === null || e.ts <= toTs + 60_000);
      if (inRange.length === 0 && (screenshots ?? []).length === 0) return current;
      return { events: mergeEvents(current.events, inRange), screenshots: mergeScreenshots(current.screenshots, screenshots ?? []) };
    });
  });

  const screenshotsById = useMemo(() => new Map((data?.screenshots ?? []).map((s) => [s.id, s])), [data]);
  const items = useMemo(() => activityItems(data?.events ?? [], data?.screenshots ?? []), [data]);

  const entryFor = useCallback(
    (item: ActivityItem): TimelineEntry => {
      if (item.kind === "screenshot") {
        const checked = selection.screenshots.has(item.screenshot.id);
        return {
          id: item.id,
          ts: item.ts,
          selected: checked,
          leading: (
            <input
              type="checkbox"
              aria-label={`Select screenshot at ${formatTime(item.ts)}`}
              checked={checked}
              onChange={(ev) => setSelection((s) => ({ ...s, screenshots: toggled(s.screenshots, item.screenshot.id, ev.target.checked) }))}
            />
          ),
          body: <ScreenshotBody screenshot={item.screenshot} />
        };
      }
      const e = item.event;
      const isGap = e.type === "privacy_gap" || e.privacy === "privacy_gap";
      if (isGap) return { id: e.id, ts: e.ts, gap: "Not captured: app outside your allowlist" };
      const checked = selection.events.has(e.id);
      return {
        id: e.id,
        ts: e.ts,
        selected: checked,
        leading: (
          <input
            type="checkbox"
            aria-label={`Select event at ${formatTime(e.ts)}`}
            checked={checked}
            onChange={(ev) => setSelection((s) => ({ ...s, events: toggled(s.events, e.id, ev.target.checked) }))}
          />
        ),
        body: <EventBody event={e} screenshot={e.screenshotRef ? screenshotsById.get(e.screenshotRef) : undefined} />
      };
    },
    [selection, screenshotsById]
  );

  const groups = useMemo<TimelineGroup[]>(() => {
    const byHour = new Map<number, ActivityItem[]>();
    for (const item of items) {
      const key = hourKey(item.ts);
      byHour.set(key, [...(byHour.get(key) ?? []), item]);
    }
    return [...byHour.entries()].map(([key, list]) => ({ key: String(key), title: `${formatDate(key)}, ${formatTime(key)}`, entries: list.map(entryFor) }));
  }, [items, entryFor]);

  const selectedCount = selection.events.size + selection.screenshots.size;

  const deleteSelected = async (): Promise<void> => {
    if (selectedCount === 0) return;
    setBusy(true);
    try {
      const events = selection.events.size > 0 ? (await invoke("activity:deleteEvents", { eventIds: [...selection.events] })).deleted : 0;
      const screenshots = selection.screenshots.size > 0 ? (await invoke("activity:deleteScreenshots", { screenshotIds: [...selection.screenshots] })).deleted : 0;
      toast("success", `Deleted ${describeCounts(events, screenshots) || "nothing"}`);
      setSelection(EMPTY_SELECTION);
      reload();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const deleteRange = async (): Promise<void> => {
    if (fromTs === null || toTs === null) return;
    setBusy(true);
    try {
      const result = await invoke("activity:deleteRange", { fromTs, toTs });
      toast("success", `Deleted ${pluralize(result.deleted, "event")} and their screenshots`);
      setSelection(EMPTY_SELECTION);
      reload();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const eventCount = data?.events.length ?? 0;
  const standaloneCount = items.length - eventCount;
  const itemCount = items.length;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>Activity</h2>
          <p>Everything captured from allowed apps, in order. Screenshots stay blurred until you reveal them.</p>
        </div>
      </div>
      <div className="activity-toolbar" role="search" aria-label="Filter activity">
        <TextInput label="From" type="datetime-local" step={1} value={from} onValueChange={setFrom} small />
        <TextInput label="To" type="datetime-local" step={1} value={to} onValueChange={setTo} small error={rangeError} />
        <TextInput label="App" value={app} onValueChange={setApp} placeholder="Mail" small />
        <TextInput label="Domain" value={domain} onValueChange={setDomain} placeholder="notion.so" small />
        <Select label="Type" value={type} onValueChange={setType} options={[{ value: "", label: "All types" }, ...EVENT_TYPES.map((t) => ({ value: t, label: humanize(t) }))]} />
        <Select label="Limit" value={String(limit)} onValueChange={(v) => setLimit(Number(v))} options={[100, 500, 1000, 2000, 5000].map((n) => ({ value: String(n), label: String(n) }))} />
        <Button onClick={() => { setFrom(toDatetimeLocal(Date.now() - DAY)); setTo(toDatetimeLocal(Date.now())); }}>
          Last 24 h
        </Button>
      </div>
      <div className="row-between">
        <span className="small muted">
          {loading
            ? "Loading"
            : `${pluralize(eventCount, "event")}${standaloneCount > 0 ? `, ${pluralize(standaloneCount, "standalone screenshot")}` : ""}${eventCount >= limit ? ` (limit reached, raise the limit or narrow the range)` : ""}`}
        </span>
        <span className="row">
          <Button size="sm" variant="danger" disabled={selectedCount === 0 || busy} onClick={() => setConfirm("selected")}>
            Delete {selectedCount > 0 ? `${selectedCount} selected` : "selected"}
          </Button>
          <Button size="sm" variant="danger" disabled={Boolean(rangeError) || busy || itemCount === 0} onClick={() => setConfirm("range")}>
            Delete this range
          </Button>
        </span>
      </div>
      {error ? <ErrorState title="Could not load activity" message={error} onRetry={reload} /> : null}
      {loading && !data ? <CardSkeleton count={3} /> : null}
      {!loading && !error && itemCount === 0 ? (
        <EmptyState title="No activity in this range" description="Either nothing was captured, learning is paused, or the filters exclude everything. Allowed apps and domains are set in Settings." />
      ) : null}
      {itemCount > 0 ? <Timeline groups={groups} label="Activity timeline" /> : null}
      <EpisodeDrawer />
      <ConfirmDialog
        open={confirm === "selected"}
        title="Delete selected items?"
        message={`This permanently deletes ${describeCounts(selection.events.size, selection.screenshots.size) || "the selection"}. Deleting an event does not delete a screenshot attached to it; select the screenshot too to remove it.`}
        confirmLabel="Delete"
        danger
        busy={busy}
        onConfirm={() => void deleteSelected()}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === "range"}
        title="Delete everything in this range?"
        message={`This permanently deletes all events and screenshots between ${from.replace("T", " ")} and ${to.replace("T", " ")}, including events not shown because of filters.`}
        confirmLabel="Delete range"
        danger
        busy={busy}
        onConfirm={() => void deleteRange()}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
