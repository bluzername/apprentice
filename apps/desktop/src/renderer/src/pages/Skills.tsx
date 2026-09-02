import { useCallback, useState, type JSX } from "react";
import type { Skill } from "@apprentice/schemas";
import { Badge, RiskBadge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ConfirmDialog } from "../components/Dialog";
import { CardSkeleton } from "../components/Skeleton";
import { EmptyState, ErrorState } from "../components/States";
import { Table, type Column } from "../components/Table";
import { invoke } from "../lib/api";
import { formatDuration, formatRelative, humanize, pluralize } from "../lib/format";
import { errorMessage, useLoader } from "../lib/hooks";
import { buildHash, navigate } from "../lib/router";
import { useStore } from "../state/store";
import { SkillEditor } from "./skills/SkillEditor";
import { SkillHistory } from "./skills/SkillHistory";

export function SkillsPage({ id }: { id?: string }): JSX.Element {
  if (id) return <SkillDetail id={id} />;
  return <SkillList />;
}

const COLUMNS: ReadonlyArray<Column<Skill>> = [
  { key: "name", header: "Skill", render: (s) => <strong>{s.name}</strong> },
  { key: "version", header: "Version", render: (s) => `v${s.version}` },
  { key: "policy", header: "Policy", render: (s) => humanize(s.policy.mode) },
  { key: "risk", header: "Risk", render: (s) => <RiskBadge risk={s.riskClass} /> },
  { key: "subtasks", header: "Subtasks", render: (s) => s.subtasks.length },
  { key: "source", header: "Source", render: (s) => humanize(s.source) },
  { key: "updated", header: "Updated", render: (s) => formatRelative(s.updatedAt) }
];

function SkillList(): JSX.Element {
  const loader = useCallback(() => invoke("skills:list"), []);
  const { data, error, loading, reload } = useLoader(loader);
  const skills = (data ?? []).filter((s) => !s.archived);
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>Skills</h2>
          <p>Inspectable, versioned routines. Run them in guide mode to be asked before every action.</p>
        </div>
        <Button variant="primary" onClick={() => navigate("teach")}>
          Teach a new skill
        </Button>
      </div>
      {error ? <ErrorState title="Could not load skills" message={error} onRetry={reload} /> : null}
      {loading && !data ? <CardSkeleton count={2} /> : null}
      {!loading && !error && skills.length === 0 ? <EmptyState title="No skills yet" description="Save a candidate with Edit and save, or teach a routine with Learn what I just did." /> : null}
      {skills.length > 0 ? <Table columns={COLUMNS} rows={skills} rowKey={(s) => s.id} onRowClick={(s) => navigate("skills", s.id)} caption="Saved skills" /> : null}
    </div>
  );
}

function SkillDetail({ id }: { id: string }): JSX.Element {
  const { toast } = useStore();
  const loader = useCallback(() => invoke("skills:get", { id }), [id]);
  const { data, error, loading, reload } = useLoader(loader);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const save = async (skill: Skill, correctionNote: string): Promise<void> => {
    setSaving(true);
    try {
      await invoke("skills:save", correctionNote.trim() ? { skill, correctionNote: correctionNote.trim() } : { skill });
      toast("success", "Skill saved as a new version");
      reload();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const runGuide = async (): Promise<void> => {
    setStarting(true);
    try {
      const run = await invoke("runs:start", { skillId: id, mode: "guide", variables: {} });
      toast("info", "Run started. You will be asked before each action.");
      navigate("runs", run.id);
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setStarting(false);
    }
  };

  const remove = async (): Promise<void> => {
    setDeleting(true);
    try {
      await invoke("skills:delete", { id });
      toast("success", "Skill deleted");
      navigate("skills");
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  if (error) return <ErrorState title="Could not load skill" message={error} onRetry={reload} />;
  if (loading || !data) return <CardSkeleton count={3} />;
  const { skill, history } = data;

  return (
    <div className="page">
      <a href={buildHash("skills")}>Back to skills</a>
      <div className="page-header">
        <div>
          <h2>{skill.name}</h2>
          <div className="row small">
            <Badge tone="neutral">v{skill.version}</Badge>
            <RiskBadge risk={skill.riskClass} />
            <span className="muted">
              {pluralize(skill.subtasks.length, "subtask")}, max {skill.maxSteps} steps, timeout {formatDuration(skill.timeoutMs)}
            </span>
          </div>
        </div>
        <div className="row">
          <Button variant="primary" busy={starting} onClick={() => void runGuide()}>
            Run in guide mode
          </Button>
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
        </div>
      </div>
      <div className="two-col">
        <SkillHistory skill={skill} history={history} />
        <div className="stack">
          <SkillEditor key={`${skill.id}-${skill.version}`} skill={skill} busy={saving} onSave={(s, note) => void save(s, note)} />
          {skill.evidence.candidateId ? (
            <Card title="Evidence">
              <a href={buildHash("candidates", skill.evidence.candidateId)}>View the candidate this skill came from</a>
            </Card>
          ) : null}
        </div>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this skill?"
        message={`"${skill.name}" and all ${versionsLabel(history.length + 1)} will be removed. Runs that used it keep their traces. This cannot be undone.`}
        confirmLabel="Delete skill"
        danger
        busy={deleting}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

function versionsLabel(n: number): string {
  return pluralize(n, "version");
}
