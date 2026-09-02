import type { JSX } from "react";
import type { ActionPolicyMode, SkillDraft } from "@apprentice/schemas";
import { Badge } from "../../components/Badge";
import { Card } from "../../components/Card";
import { TextArea, TextInput } from "../../components/Field";
import { ListEditor } from "../../components/ListEditor";
import { validateDomain } from "../../lib/domain";
import { formatPercent } from "../../lib/format";
import { PolicySelect } from "../skills/PolicySelect";
import { SubtaskEditor } from "../skills/SubtaskEditor";
import { VariableEditor } from "../skills/VariableEditor";

interface DraftEditorProps {
  draft: SkillDraft;
  mode: ActionPolicyMode;
  onChange: (draft: SkillDraft) => void;
  onModeChange: (mode: ActionPolicyMode) => void;
}

export function draftErrors(draft: SkillDraft): string[] {
  const errors: string[] = [];
  if (!draft.name.trim()) errors.push("Name is required.");
  if (!draft.trigger.trim()) errors.push("Trigger is required.");
  if (draft.subtasks.length === 0) errors.push("Add at least one subtask.");
  draft.subtasks.forEach((s, i) => {
    if (!s.title.trim() || !s.goal.trim() || !s.completionCriteria.trim()) errors.push(`Subtask ${i + 1} needs a title, goal and completion criteria.`);
  });
  return errors;
}

export function DraftEditor({ draft, mode, onChange, onModeChange }: DraftEditorProps): JSX.Element {
  const patch = (p: Partial<SkillDraft>): void => onChange({ ...draft, ...p });
  return (
    <div className="stack-lg">
      <Card title="Skill draft" actions={<Badge tone={draft.origin === "model_refined" ? "accent" : "neutral"}>{draft.origin === "model_refined" ? `Refined by the local model (${formatPercent(draft.confidence)})` : "Deterministic draft"}</Badge>}>
        <div className="stack">
          <TextInput label="Name" value={draft.name} onValueChange={(name) => patch({ name })} maxLength={120} />
          <TextArea label="Description" value={draft.description} onValueChange={(description) => patch({ description })} maxLength={1000} rows={2} />
          <TextInput label="Goal" value={draft.goal} onValueChange={(goal) => patch({ goal })} maxLength={500} />
          <TextArea label="Trigger" value={draft.trigger} onValueChange={(trigger) => patch({ trigger })} maxLength={500} rows={2} />
        </div>
      </Card>
      <Card title="Subtasks">
        <SubtaskEditor subtasks={draft.subtasks} onChange={(subtasks) => patch({ subtasks })} />
      </Card>
      <Card title="Variables">
        <VariableEditor variables={draft.variables} onChange={(variables) => patch({ variables })} />
      </Card>
      <Card title="Success criteria">
        <ListEditor label="Success criteria" items={draft.successCriteria} onChange={(successCriteria) => patch({ successCriteria })} max={10} placeholder="The draft email contains every action item" />
        {draft.riskNotes.length > 0 ? (
          <div className="callout callout-warning" style={{ marginTop: 12 }}>
            <strong>Risk notes:</strong>
            <ul style={{ marginBottom: 0 }}>
              {draft.riskNotes.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>
      <Card title="Scope and policy">
        <div className="grid-2">
          <ListEditor label="Allowed apps (bundle ids)" items={draft.allowedApps} onChange={(allowedApps) => patch({ allowedApps })} placeholder="com.apple.mail" />
          <ListEditor label="Allowed domains" items={draft.allowedDomains} onChange={(allowedDomains) => patch({ allowedDomains })} placeholder="notion.so" validate={validateDomain} />
        </div>
        <div style={{ marginTop: 12 }}>
          <PolicySelect value={mode} onChange={onModeChange} />
        </div>
      </Card>
    </div>
  );
}
