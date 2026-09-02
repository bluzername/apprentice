import { useCallback, useState, type JSX } from "react";
import type { Feedback } from "@apprentice/schemas";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { CardSkeleton } from "../components/Skeleton";
import { ErrorState } from "../components/States";
import { Table, type Column } from "../components/Table";
import { invoke } from "../lib/api";
import { formatDateTime, humanize } from "../lib/format";
import { errorMessage, useLoader } from "../lib/hooks";
import { useStore } from "../state/store";
import { ExportBundleDialog } from "./feedback/ExportBundleDialog";
import { GeneralFeedbackForm } from "./feedback/GeneralFeedbackForm";
import { FeedbackConsent } from "./shared/FeedbackConsent";

function answersSummary(f: Feedback): string {
  const a = f.answers;
  switch (a.kind) {
    case "candidate":
      return `relevant ${a.relevant ? "yes" : "no"}, delegate ${a.wouldDelegate}, boundary ${humanize(a.boundaryAccuracy).toLowerCase()}${a.reasonCodes.length ? `, ${a.reasonCodes.map(humanize).join(", ")}` : ""}`;
    case "run":
      return `outcome ${a.outcomeAchieved}, trust ${a.trustRating}/5, ${a.corrections} corrections, ${a.estimatedTimeSavedMinutes} min saved, ${a.wouldUseAgain ? "would use again" : "would not use again"}`;
    case "pulse":
      return `day ${a.day}, ${a.stillUsing ? "still using" : "stopped"}, most useful ${humanize(a.mostUseful).toLowerCase()}, concern ${a.biggestConcern}, score ${a.recommendScore}/10`;
    case "general":
      return `sentiment ${a.sentiment}`;
  }
}

const COLUMNS: ReadonlyArray<Column<Feedback>> = [
  { key: "when", header: "When", render: (f) => formatDateTime(f.createdAt), width: "160px" },
  { key: "type", header: "Type", render: (f) => humanize(f.contextType) },
  { key: "answers", header: "Answers", render: (f) => answersSummary(f) },
  { key: "comment", header: "Comment", render: (f) => (f.comment ? <span className="muted">{f.comment}</span> : "") },
  { key: "status", header: "Upload", render: (f) => <Badge tone={f.uploadStatus === "uploaded" ? "success" : f.uploadStatus === "failed" ? "danger" : "neutral"}>{humanize(f.uploadStatus)}</Badge> }
];

export function FeedbackPage(): JSX.Element {
  const { state, toast } = useStore();
  const loader = useCallback(() => invoke("feedback:list"), []);
  const { data, error, loading, reload } = useLoader(loader);
  const [exportOpen, setExportOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const consent = state.settings?.feedback.remoteConsent ?? false;

  const upload = async (): Promise<void> => {
    setUploading(true);
    try {
      const result = await invoke("feedback:upload");
      toast(result.ok ? "success" : "warning", result.message ?? (result.ok ? `Uploaded ${result.uploaded} items` : "Upload did not complete"));
      reload();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>Feedback</h2>
          <p>Everything you told Apprentice, stored on this Mac. Remote upload is off unless you turned it on.</p>
        </div>
        <div className="row">
          <Badge tone={consent ? "warning" : "success"} dot>
            {consent ? "Remote upload enabled" : "Local only"}
          </Badge>
        </div>
      </div>
      <div className="grid-2">
        <Card title="General feedback">
          <GeneralFeedbackForm onSubmitted={reload} />
        </Card>
        <Card title="Sharing">
          <div className="stack">
            <FeedbackConsent compact />
            <hr className="divider" />
            <div className="row">
              <Button busy={uploading} disabled={!consent} onClick={() => void upload()} title={consent ? undefined : "Enable remote consent first"}>
                Upload now
              </Button>
              <Button onClick={() => setExportOpen(true)}>Export feedback bundle</Button>
            </div>
          </div>
        </Card>
      </div>
      <Card title="Local feedback log">
        {error ? <ErrorState message={error} onRetry={reload} /> : loading && !data ? <CardSkeleton count={1} /> : <Table columns={COLUMNS} rows={data ?? []} rowKey={(f) => f.id} caption="Local feedback" emptyMessage="No feedback recorded yet." />}
      </Card>
      <ExportBundleDialog open={exportOpen} onClose={() => setExportOpen(false)} />
    </div>
  );
}
