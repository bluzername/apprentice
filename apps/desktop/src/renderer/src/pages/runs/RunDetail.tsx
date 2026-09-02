import { useCallback, useEffect, useState, type JSX } from "react";
import type { ApprovalRequest, FailureCategory, RunDetail as RunDetailData, RunStatus } from "@apprentice/schemas";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { TextInput } from "../../components/Field";
import { CardSkeleton } from "../../components/Skeleton";
import { ErrorState } from "../../components/States";
import { describeAction } from "../../lib/annotation";
import { invoke } from "../../lib/api";
import { failureLabel, formatDateTime, formatDuration, humanize, isRunActive, runStatusLabel } from "../../lib/format";
import { errorMessage, useIpcEvent, useLoader } from "../../lib/hooks";
import { buildHash } from "../../lib/router";
import { useStore } from "../../state/store";
import { ApprovalPanel } from "./ApprovalPanel";
import { DiagnosticsButton } from "./DiagnosticsDialog";
import { RunFeedbackForm } from "./RunFeedbackForm";
import { RunTrace } from "./RunTrace";

const TEXT_INPUT_TYPES = new Set(["text", "search", "url", "email", "tel", "password", "number"]);

function statusTone(status: string): "success" | "danger" | "warning" | "info" | "neutral" {
  if (status === "completed") return "success";
  if (status === "failed" || status.startsWith("aborted")) return "danger";
  if (status === "interrupted" || status === "timed_out") return "warning";
  if (status === "running" || status.startsWith("awaiting")) return "info";
  return "neutral";
}

/** Text for the persistent status region; changes only when the run or the pending approval changes. */
export function liveStatusMessage(status: RunStatus, failure: FailureCategory, approval: ApprovalRequest | null): string {
  if (approval && isRunActive(status)) return `Approval needed: step ${approval.stepIndex + 1}, ${approval.actionSummary || describeAction(approval.proposed)}`;
  if (status === "completed") return "Run completed";
  if (status === "failed") return `Run failed: ${failureLabel(failure)}`;
  if (status === "awaiting_user") return "The run has a question";
  if (status === "running" || status === "pending") return "Run in progress";
  return `Run ${runStatusLabel(status).toLowerCase()}`;
}

/** True when Escape should be left to the focused control instead of stopping the run. */
function escapeBelongsToTarget(target: EventTarget | null): boolean {
  if (document.querySelector("dialog[open]")) return true;
  if (!(target instanceof Element)) return false;
  if (target.closest('[aria-expanded="true"], .menu, [role="dialog"]')) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type);
}

export function RunDetail({ id }: { id: string }): JSX.Element {
  const { state, dispatch, toast } = useStore();
  const loader = useCallback(() => invoke("runs:get", { id }), [id]);
  const { data, error, loading, reload, setData } = useLoader(loader);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState("");
  const [confirmSubtask, setConfirmSubtask] = useState(false);
  const [feedbackDone, setFeedbackDone] = useState(false);
  const [liveStatus, setLiveStatus] = useState("");

  useIpcEvent("event:run", ({ detail }) => {
    if (detail.run.id === id) setData(() => detail);
  });

  const globalApproval = state.pendingApproval && state.pendingApproval.runId === id ? state.pendingApproval : null;
  const approval = data?.pendingApproval ?? globalApproval;
  const run = data?.run;
  const active = run ? isRunActive(run.status) : false;
  const runStatus = run?.status;
  const failureCategory = run?.failureCategory;

  // Setting an identical string is a no-op, so the region only re-announces when
  // the run status or the pending approval actually changes.
  useEffect(() => {
    if (!runStatus || !failureCategory) return;
    setLiveStatus(liveStatusMessage(runStatus, failureCategory, approval));
  }, [runStatus, failureCategory, approval]);

  const apply = useCallback(
    async (fn: () => Promise<RunDetailData>): Promise<void> => {
      setBusy(true);
      try {
        const detail = await fn();
        setData(() => detail);
        if (!detail.pendingApproval) dispatch({ type: "approval", approval: null });
      } catch (err) {
        toast("error", errorMessage(err));
      } finally {
        setBusy(false);
      }
    },
    [dispatch, setData, toast]
  );

  const stop = useCallback((): void => {
    void apply(() => invoke("runs:stop", { runId: id }));
  }, [apply, id]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape" || e.defaultPrevented || escapeBelongsToTarget(e.target)) return;
      e.preventDefault();
      stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, stop]);

  const statusRegion = (
    <div role="status" className="visually-hidden">
      {liveStatus}
    </div>
  );

  if (error) {
    return (
      <>
        {statusRegion}
        <ErrorState title="Could not load run" message={error} onRetry={reload} />
      </>
    );
  }
  if (loading || !data || !run) {
    return (
      <>
        {statusRegion}
        <CardSkeleton count={3} />
      </>
    );
  }

  const currentSubtask = Math.min(run.currentSubtaskIndex + 1, run.subtaskCount);

  return (
    <div className="page">
      {statusRegion}
      <a href={buildHash("runs")}>Back to runs</a>
      <div className="page-header">
        <div>
          <h2>{run.skillName}</h2>
          <div className="row small">
            <Badge tone={statusTone(run.status)} dot>{runStatusLabel(run.status)}</Badge>
            <span className="muted">
              {humanize(run.mode)} mode, skill v{run.skillVersion}, {run.provider}
              {run.model ? ` / ${run.model}` : ""}
            </span>
          </div>
        </div>
        {active ? (
          <Button variant="stop" onClick={stop} busy={busy} aria-keyshortcuts="Escape">
            Stop run (Esc)
          </Button>
        ) : null}
      </div>

      {approval && active ? <ApprovalPanel request={approval} busy={busy} onDecide={(decision, scope) => void apply(() => invoke("runs:approve", { runId: id, stepId: approval.stepId, decision, scope }))} /> : null}

      {data.pendingQuestion && active ? (
        <Card title="The run has a question">
          <p>{data.pendingQuestion.question}</p>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              const q = data.pendingQuestion;
              if (!q) return;
              void apply(() => invoke("runs:answer", { runId: id, stepId: q.stepId, answer: answer.trim(), confirmSubtask }));
              setAnswer("");
            }}
          >
            <TextInput label="Your answer" value={answer} onValueChange={setAnswer} maxLength={500} />
            <label className="check-inline">
              <input type="checkbox" checked={confirmSubtask} onChange={(e) => setConfirmSubtask(e.target.checked)} /> This also confirms the current subtask is complete
            </label>
            <div>
              <Button type="submit" variant="primary" busy={busy} disabled={answer.trim().length === 0}>
                Send answer
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      <div className="grid-4">
        <Card>
          <div className="stat-label">Current subtask</div>
          <div className="stat">
            {currentSubtask}/{run.subtaskCount}
          </div>
        </Card>
        <Card>
          <div className="stat-label">Steps</div>
          <div className="stat">{run.metrics.steps}</div>
          <div className="small muted">{run.metrics.approvedActions} approved, {run.metrics.rejectedActions} rejected</div>
        </Card>
        <Card>
          <div className="stat-label">Duration</div>
          <div className="stat">{formatDuration((run.endedAt ?? Date.now()) - run.startedAt)}</div>
          <div className="small muted">started {formatDateTime(run.startedAt)}</div>
        </Card>
        <Card>
          <div className="stat-label">Model latency</div>
          <div className="stat">{run.metrics.modelLatencyMsMax} ms</div>
          <div className="small muted">max, {run.metrics.screenshotsUsed} screenshots used</div>
        </Card>
      </div>

      {!active ? (
        <div className="callout">
          <div className="row">
            <strong>Finished:</strong> {runStatusLabel(run.status)}
            {run.failureCategory !== "none" ? <Badge tone="danger">{failureLabel(run.failureCategory)}</Badge> : null}
            {run.interruptedBy ? <span className="muted">interrupted by {humanize(run.interruptedBy)}</span> : null}
          </div>
          {run.summary ? <p style={{ marginTop: 6 }}>{run.summary}</p> : null}
        </div>
      ) : null}

      <Card title="Step-by-step trace">
        <RunTrace steps={data.steps} />
      </Card>

      {!active && !feedbackDone ? <RunFeedbackForm runId={id} defaultFailure={run.failureCategory} onDone={() => setFeedbackDone(true)} /> : null}
      {!active ? (
        <Card title="Diagnostics">
          <p className="small muted">Export a sanitised trace of this run for the alpha team. You see every file before it is written; screenshots, OCR and typed text are removed.</p>
          <DiagnosticsButton runId={id} />
        </Card>
      ) : null}
    </div>
  );
}
