import { useCallback, useEffect, useState, type JSX } from "react";
import type { ActionPolicyMode, SkillDraft } from "@apprentice/schemas";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Select } from "../components/Field";
import { ScreenshotThumb } from "../components/ScreenshotThumb";
import { CardSkeleton } from "../components/Skeleton";
import { EmptyState, ErrorState } from "../components/States";
import { invoke } from "../lib/api";
import { formatTimeWithSeconds, pluralize } from "../lib/format";
import { errorMessage, useLoader } from "../lib/hooks";
import { includedItems, type TimeRange } from "../lib/range-math";
import { navigate } from "../lib/router";
import { useStore } from "../state/store";
import { eventTitle, eventLocation } from "./activity/EventBody";
import { RangeEditor } from "./teach/RangeEditor";
import { DraftEditor, draftErrors } from "./teach/DraftEditor";

type Retained = { eventCount: number; screenshotCount: number; fields: string[] };

/** "Learn what I just did": pick a range, prune steps, draft, review retention, save. */
export function TeachPage(): JSX.Element {
  const { toast } = useStore();
  const [minutes, setMinutes] = useState(15);
  const loader = useCallback(() => invoke("teach:openRange", { minutes }), [minutes]);
  const { data, error, loading, reload } = useLoader(loader);
  const [range, setRange] = useState<TimeRange | null>(null);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [draft, setDraft] = useState<SkillDraft | null>(null);
  const [retained, setRetained] = useState<Retained | null>(null);
  const [mode, setMode] = useState<ActionPolicyMode>("guide");
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) {
      setRange({ startTs: data.startTs, endTs: data.endTs });
      setExcluded(new Set());
      setDraft(null);
      setRetained(null);
    }
  }, [data]);

  const bounds: TimeRange | null = data ? { startTs: data.startTs, endTs: data.endTs } : null;
  const events = data?.events ?? [];
  const screenshots = data?.screenshots ?? [];
  const included = range ? includedItems(events, range, excluded) : [];
  const includedShots = range ? includedItems(screenshots, range) : [];

  const toggleExcluded = (id: string, isExcluded: boolean): void => {
    const next = new Set(excluded);
    if (isExcluded) next.add(id);
    else next.delete(id);
    setExcluded(next);
    setDraft(null);
    setRetained(null);
  };

  const generate = async (): Promise<void> => {
    if (!range) return;
    setDrafting(true);
    try {
      const result = await invoke("teach:draft", { startTs: range.startTs, endTs: range.endTs, excludedEventIds: [...excluded] });
      setDraft(result.draft);
      setRetained(result.retained);
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setDrafting(false);
    }
  };

  const save = async (): Promise<void> => {
    if (!range || !draft) return;
    setSaving(true);
    try {
      const skill = await invoke("teach:save", { draft, range: { startTs: range.startTs, endTs: range.endTs, excludedEventIds: [...excluded] }, mode });
      toast("success", `Saved "${skill.name}" as version ${skill.version}`);
      navigate("skills", skill.id);
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>Learn what I just did</h2>
          <p>Choose the exact stretch of activity to turn into a skill. Nothing outside the range or unchecked below is kept.</p>
        </div>
        <div className="row">
          <Select label="Look back" value={String(minutes)} onValueChange={(v) => setMinutes(Number(v))} options={[5, 15, 30, 60, 120].map((m) => ({ value: String(m), label: `${m} minutes` }))} />
        </div>
      </div>
      {error ? <ErrorState title="Could not open recent activity" message={error} onRetry={reload} /> : null}
      {loading && !data ? <CardSkeleton count={2} /> : null}
      {data && bounds && range ? (
        <>
          <Card title="1. Set the boundaries">
            {events.length === 0 ? (
              <EmptyState title="Nothing captured in this window" description="Only allowed apps and domains are recorded. Widen the look-back or check the allowlist in Settings." />
            ) : (
              <RangeEditor bounds={bounds} value={range} onChange={(next) => { setRange(next); setDraft(null); setRetained(null); }} events={events} screenshots={screenshots} excluded={excluded} />
            )}
          </Card>
          <Card title="2. Remove private or irrelevant steps">
            <p className="small muted">
              {pluralize(included.length, "event")} and {pluralize(includedShots.length, "screenshot")} inside the range. Uncheck anything you do not want retained.
            </p>
            <div className="teach-events">
              {events.map((e) => {
                const inside = e.ts >= range.startTs && e.ts <= range.endTs;
                const isExcluded = excluded.has(e.id);
                const shot = e.screenshotRef ? screenshots.find((s) => s.id === e.screenshotRef) : undefined;
                return (
                  <div key={e.id} className={`teach-event ${inside ? "" : "outside"} ${isExcluded ? "excluded" : ""}`.trim()}>
                    <input type="checkbox" aria-label={`Keep ${eventTitle(e)} at ${formatTimeWithSeconds(e.ts)}`} checked={inside && !isExcluded} disabled={!inside} onChange={(ev) => toggleExcluded(e.id, !ev.target.checked)} />
                    <span className="timeline-time">{formatTimeWithSeconds(e.ts)}</span>
                    <span>
                      <span className="event-type">{eventTitle(e)}</span>
                      <span className="event-meta"> {eventLocation(e)}</span>
                    </span>
                    {shot ? <ScreenshotThumb id={shot.id} width={shot.width} height={shot.height} maxWidth={96} label={eventTitle(e)} /> : <span />}
                  </div>
                );
              })}
            </div>
          </Card>
          <Card title="3. Generate a draft">
            <div className="row">
              <Button variant="primary" busy={drafting} disabled={included.length === 0} onClick={() => void generate()}>
                Generate draft
              </Button>
              <span className="small muted">Runs locally. The model, when configured, refines names and steps; otherwise a deterministic draft is produced.</span>
            </div>
            {retained ? (
              <div className="retention-preview" style={{ marginTop: 12 }} role="status">
                <strong>What will be retained if you save</strong>
                <ul style={{ margin: "6px 0 0" }}>
                  <li>{pluralize(retained.eventCount, "event")} (types, app names, domains, route patterns and element labels only)</li>
                  <li>{pluralize(retained.screenshotCount, "screenshot")}, encrypted at rest</li>
                  <li>Fields: {retained.fields.join(", ")}</li>
                </ul>
                <p className="small" style={{ marginTop: 6 }}>Never retained: keystrokes, field values, clipboard contents, or anything outside the allowlist.</p>
              </div>
            ) : null}
          </Card>
          {draft ? (
            <>
              <DraftEditor draft={draft} mode={mode} onChange={setDraft} onModeChange={setMode} />
              <Card title="4. Save">
                {draftErrors(draft).length > 0 ? (
                  <ul className="field-error" role="alert">
                    {draftErrors(draft).map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                ) : null}
                <div className="row">
                  <Button variant="primary" size="lg" busy={saving} disabled={draftErrors(draft).length > 0} onClick={() => void save()}>
                    Save skill
                  </Button>
                  <Button variant="ghost" onClick={() => navigate("overview")} disabled={saving}>
                    Cancel
                  </Button>
                </div>
              </Card>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
