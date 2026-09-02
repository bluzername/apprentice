import { useCallback, useMemo, useState, type JSX } from "react";
import type { ActivityEvent } from "@apprentice/schemas";
import { Button } from "../components/Button";
import { ConfirmDialog } from "../components/Dialog";
import { Select, TextInput } from "../components/Field";
import { CardSkeleton } from "../components/Skeleton";
import { EmptyState, ErrorState } from "../components/States";
import { Timeline, type TimelineGroup } from "../components/Timeline";
import { invoke } from "../lib/api";
import { formatDate, formatTime, fromDatetimeLocal, hourKey, humanize, pluralize, toDatetimeLocal } from "../lib/format";
import { errorMessage, useIpcEvent, useLoader } from "../lib/hooks";
import { useStore } from "../state/store";
import { EventBody } from "./activity/EventBody";
import { EpisodeDrawer } from "./activity/EpisodeDrawer";

const EVENT_TYPES = ["app_activated", "navigation", "click", "form_submit", "shortcut", "copy", "paste", "download", "privacy_gap", "idle_changed", "teach_marker", "screenshot_captured"] as const;
const DAY = 24 * 60 * 60_000;

export function ActivityPage(): JSX.Element {
  const { toast } = useStore();
  const [from, setFrom] = useState(() => toDatetimeLocal(Date.now() - DAY));
  const [to, setTo] = useState(() => toDatetimeLocal(Date.now()));
  const [app, setApp] = useState("");
  const [domain, setDomain] = useState("");
  const [type, setType] = useState("");
  const [limit, setLimit] = useState(500);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirm, setConfirm] = useState<"selected" | "range" | null>(null);
  const [busy, setBusy] = useState(false);

  const fromTs = fromDatetimeLocal(from);
  const toTs = fromDatetimeLocal(to);
  const rangeError = fromTs === null || toTs === null ? "Enter valid dates." : fromTs >= toTs ? "Start must be before end." : null;

  const loader = useCallback(() => {
    if (fromTs === null || toTs === null || fromTs >= toTs) return Promise.resolve({ events: [] as ActivityEvent[], screenshots: [] });
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

  useIpcEvent("event:activity", ({ events }) => {
    setData((current) => {
      if (!current) return current;
      const known = new Set(current.events.map((e) => e.id));
      const fresh = events.filter((e) => !known.has(e.id) && (toTs === null || e.ts <= toTs + 60_000));
      if (fresh.length === 0) return current;
      return { ...current, events: [...current.events, ...fresh].sort((a, b) => a.ts - b.ts) };
    });
  });

  const screenshotsById = useMemo(() => new Map((data?.screenshots ?? []).map((s) => [s.id, s])), [data]);

  const groups = useMemo<TimelineGroup[]>(() => {
    const events = [...(data?.events ?? [])].sort((a, b) => a.ts - b.ts);
    const byHour = new Map<number, ActivityEvent[]>();
    for (const e of events) {
      const key = hourKey(e.ts);
      byHour.set(key, [...(byHour.get(key) ?? []), e]);
    }
    return [...byHour.entries()].map(([key, list]) => ({
      key: String(key),
      title: `${formatDate(key)}, ${formatTime(key)}`,
      entries: list.map((e) => {
        const isGap = e.type === "privacy_gap" || e.privacy === "privacy_gap";
        if (isGap) return { id: e.id, ts: e.ts, gap: "Not captured: app outside your allowlist" };
        return {
          id: e.id,
          ts: e.ts,
          selected: selected.has(e.id),
          leading: (
            <input
              type="checkbox"
              aria-label={`Select event at ${formatTime(e.ts)}`}
              checked={selected.has(e.id)}
              onChange={(ev) => {
                const next = new Set(selected);
                if (ev.target.checked) next.add(e.id);
                else next.delete(e.id);
                setSelected(next);
              }}
            />
          ),
          body: <EventBody event={e} screenshot={e.screenshotRef ? screenshotsById.get(e.screenshotRef) : undefined} />
        };
      })
    }));
  }, [data, selected, screenshotsById]);

  const deleteSelected = async (): Promise<void> => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      const result = await invoke("activity:deleteEvents", { eventIds: [...selected] });
      toast("success", `Deleted ${pluralize(result.deleted, "event")}`);
      setSelected(new Set());
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
      setSelected(new Set());
      reload();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const eventCount = data?.events.length ?? 0;

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
          {loading ? "Loading" : `${pluralize(eventCount, "event")}${eventCount >= limit ? ` (limit reached, raise the limit or narrow the range)` : ""}`}
        </span>
        <span className="row">
          <Button size="sm" variant="danger" disabled={selected.size === 0 || busy} onClick={() => setConfirm("selected")}>
            Delete {selected.size > 0 ? pluralize(selected.size, "selected event") : "selected"}
          </Button>
          <Button size="sm" variant="danger" disabled={Boolean(rangeError) || busy || eventCount === 0} onClick={() => setConfirm("range")}>
            Delete this range
          </Button>
        </span>
      </div>
      {error ? <ErrorState title="Could not load activity" message={error} onRetry={reload} /> : null}
      {loading && !data ? <CardSkeleton count={3} /> : null}
      {!loading && !error && eventCount === 0 ? (
        <EmptyState title="No activity in this range" description="Either nothing was captured, learning is paused, or the filters exclude everything. Allowed apps and domains are set in Settings." />
      ) : null}
      {eventCount > 0 ? <Timeline groups={groups} label="Activity timeline" /> : null}
      <EpisodeDrawer />
      <ConfirmDialog
        open={confirm === "selected"}
        title="Delete selected events?"
        message={`This permanently deletes ${pluralize(selected.size, "event")} and any screenshots attached only to them.`}
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
