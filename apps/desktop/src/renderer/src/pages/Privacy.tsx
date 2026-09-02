import { useCallback, useState, type JSX } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Field } from "../components/Field";
import { CardSkeleton } from "../components/Skeleton";
import { ErrorState } from "../components/States";
import { invoke } from "../lib/api";
import { formatBytes, pluralize } from "../lib/format";
import { errorMessage, useLoader } from "../lib/hooks";
import { useStore } from "../state/store";
import { DeleteControls } from "./privacy/DeleteControls";
import { ExtensionPairing } from "./privacy/ExtensionPairing";
import { AllowlistEditor } from "./shared/AllowlistEditor";
import { FeedbackConsent } from "./shared/FeedbackConsent";
import { ExportBundleDialog } from "./feedback/ExportBundleDialog";

const RETENTION: ReadonlyArray<{ key: "screenshotHours" | "ocrDays" | "eventsDays"; label: string; max: number; unit: string }> = [
  { key: "screenshotHours", label: "Screenshots", max: 24, unit: "hours" },
  { key: "ocrDays", label: "OCR text", max: 7, unit: "days" },
  { key: "eventsDays", label: "Events", max: 30, unit: "days" }
];

export function PrivacyPage(): JSX.Element {
  const { state, updateSettings, toast } = useStore();
  const loader = useCallback(() => invoke("privacy:stats"), []);
  const { data, error, loading, reload } = useLoader(loader);
  const [exportOpen, setExportOpen] = useState(false);
  const [retentionBusy, setRetentionBusy] = useState(false);
  const settings = state.settings;

  const saveAllowlist = async (allowlist: { apps: { bundleId: string; name: string }[]; domains: string[] }): Promise<void> => {
    try {
      await updateSettings({ allowlist });
    } catch (err) {
      toast("error", errorMessage(err));
    }
  };

  const saveRetention = async (key: "screenshotHours" | "ocrDays" | "eventsDays", value: number): Promise<void> => {
    if (!settings) return;
    try {
      await updateSettings({ retention: { ...settings.retention, [key]: value } });
    } catch (err) {
      toast("error", errorMessage(err));
    }
  };

  const runRetention = async (): Promise<void> => {
    setRetentionBusy(true);
    try {
      const r = await invoke("privacy:retentionRun");
      toast("success", `Retention removed ${r.deletedScreenshots} screenshots, ${r.deletedOcr} OCR results and ${r.deletedEvents} events`);
      reload();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setRetentionBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>Privacy</h2>
          <p>What is captured, how long it is kept, and how to remove it. All data stays on this Mac unless you export or upload it.</p>
        </div>
      </div>
      {error ? <ErrorState title="Could not load privacy statistics" message={error} onRetry={reload} /> : null}
      {loading && !data ? <CardSkeleton count={2} /> : null}
      {data ? (
        <div className="grid-4">
          <Card>
            <div className="stat-label">Stored data</div>
            <div className="stat">{formatBytes(data.storedBytes)}</div>
            <div className="small muted">screenshots {formatBytes(data.screenshotBytes)}, database {formatBytes(data.databaseBytes)}</div>
          </Card>
          <Card>
            <div className="stat-label">Screenshots</div>
            <div className="stat">{data.screenshotCount}</div>
            <div className="small muted">encrypted, {data.ocrCount} with OCR</div>
          </Card>
          <Card>
            <div className="stat-label">Events</div>
            <div className="stat">{data.eventCount}</div>
            <div className="small muted">
              {pluralize(data.episodeCount, "episode")}, {pluralize(data.candidateCount, "candidate")}
            </div>
          </Card>
          <Card>
            <div className="stat-label">Learned</div>
            <div className="stat">{data.skillCount}</div>
            <div className="small muted">
              {pluralize(data.runCount, "run")}, {pluralize(data.feedbackCount, "feedback record")}, {data.queuedUploads} queued uploads
            </div>
          </Card>
        </div>
      ) : null}
      <div className="grid-2">
        <Card title="Allowed apps and domains">
          {settings ? <AllowlistEditor value={settings.allowlist} onChange={(v) => void saveAllowlist(v)} showSuggestions={false} /> : null}
        </Card>
        <div className="stack">
          <Card title="Active exclusions">
            <p className="small muted">Always denied, regardless of the allowlist: password managers, banking, health portals and sign-in pages.</p>
            {data ? (
              <div className="chips">
                {data.activeExclusions.map((x) => (
                  <span key={x} className="chip">
                    {x}
                  </span>
                ))}
              </div>
            ) : null}
          </Card>
          <Card title="Retention" actions={<Button size="sm" busy={retentionBusy} onClick={() => void runRetention()}>Run retention now</Button>}>
            {settings ? (
              <div className="stack">
                {RETENTION.map((r) => (
                  <Field key={r.key} label={`${r.label}: ${settings.retention[r.key]} ${r.unit} (max ${r.max})`}>
                    {({ id }) => <input id={id} type="range" className="range" min={1} max={r.max} step={1} value={settings.retention[r.key]} onChange={(e) => void saveRetention(r.key, Number(e.target.value))} />}
                  </Field>
                ))}
              </div>
            ) : null}
          </Card>
        </div>
      </div>
      <Card title="Data folder">
        <div className="row-between">
          <code className="small">{data?.dataDirectory ?? ""}</code>
          <Button size="sm" onClick={() => void invoke("app:openDataFolder").catch((err: unknown) => toast("error", errorMessage(err)))}>
            Open in Finder
          </Button>
        </div>
      </Card>
      <DeleteControls onChanged={reload} />
      <div className="grid-2">
        <Card title="Export">
          <p className="small muted">Write a sanitised bundle of your feedback to this Mac. Screenshots are excluded unless you pick them one by one.</p>
          <Button onClick={() => setExportOpen(true)}>Export feedback bundle</Button>
        </Card>
        <ExtensionPairing />
      </div>
      <Card title="Feedback consent">
        <FeedbackConsent />
      </Card>
      <ExportBundleDialog open={exportOpen} onClose={() => setExportOpen(false)} />
    </div>
  );
}
