import { useState, type JSX } from "react";
import type { ActionPolicyMode, Skill } from "@apprentice/schemas";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { TextArea, TextInput } from "../../components/Field";
import { ListEditor } from "../../components/ListEditor";
import { validateDomain } from "../../lib/domain";
import { PolicySelect } from "./PolicySelect";
import { SubtaskEditor, type SubtaskValue } from "./SubtaskEditor";
import { VariableEditor } from "./VariableEditor";

interface SkillEditorProps {
  skill: Skill;
  busy: boolean;
  onSave: (skill: Skill, correctionNote: string) => void;
}

function newId(): string {
  return `st-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function skillValidationErrors(skill: Skill): string[] {
  const errors: string[] = [];
  if (!skill.name.trim()) errors.push("Name is required.");
  if (!skill.trigger.trim()) errors.push("Trigger is required.");
  if (skill.subtasks.length === 0) errors.push("Add at least one subtask.");
  skill.subtasks.forEach((s, i) => {
    if (!s.title.trim() || !s.goal.trim() || !s.completionCriteria.trim()) errors.push(`Subtask ${i + 1} needs a title, goal and completion criteria.`);
  });
  if (skill.maxSteps < 1 || skill.maxSteps > 200) errors.push("Max steps must be between 1 and 200.");
  if (skill.timeoutMs < 60_000) errors.push("Timeout must be at least 1 minute.");
  return errors;
}

export function SkillEditor({ skill: initial, busy, onSave }: SkillEditorProps): JSX.Element {
  const [skill, setSkill] = useState<Skill>(initial);
  const [note, setNote] = useState("");
  const errors = skillValidationErrors(skill);
  const patch = (p: Partial<Skill>): void => setSkill((s) => ({ ...s, ...p }));

  const setSubtasks = (subtasks: SubtaskValue[]): void =>
    patch({
      subtasks: subtasks.map((s, i) => ({
        id: skill.subtasks[i]?.id ?? newId(),
        title: s.title,
        goal: s.goal,
        completionCriteria: s.completionCriteria,
        keySteps: s.keySteps,
        completionPredicates: skill.subtasks[i]?.completionPredicates ?? [],
        ...(s.appOrDomain ? { appOrDomain: s.appOrDomain } : {})
      }))
    });

  return (
    <form
      className="stack-lg"
      onSubmit={(e) => {
        e.preventDefault();
        if (errors.length === 0) onSave(skill, note);
      }}
    >
      <Card title="Identity">
        <div className="stack">
          <TextInput label="Name" value={skill.name} onValueChange={(name) => patch({ name })} maxLength={120} />
          <TextArea label="Description" value={skill.description} onValueChange={(description) => patch({ description })} maxLength={1000} rows={2} />
          <TextArea label="Trigger" value={skill.trigger} onValueChange={(trigger) => patch({ trigger })} maxLength={500} rows={2} hint="When this routine usually starts, in plain words." />
          <ListEditor label="Preconditions" items={skill.preconditions} onChange={(preconditions) => patch({ preconditions })} max={10} placeholder="Mail is signed in" />
        </div>
      </Card>
      <Card title="Subtasks">
        <SubtaskEditor subtasks={skill.subtasks} onChange={setSubtasks} />
      </Card>
      <Card title="Variables">
        <VariableEditor variables={skill.variables} onChange={(variables) => patch({ variables })} />
      </Card>
      <Card title="Success criteria">
        <ListEditor label="Success criteria" items={skill.successCriteria} onChange={(successCriteria) => patch({ successCriteria })} max={10} placeholder="Draft contains every action item" />
      </Card>
      <Card title="Scope">
        <div className="grid-2">
          <ListEditor label="Allowed apps (bundle ids)" items={skill.allowedApps} onChange={(allowedApps) => patch({ allowedApps })} placeholder="com.apple.mail" />
          <ListEditor label="Allowed domains" items={skill.allowedDomains} onChange={(allowedDomains) => patch({ allowedDomains })} placeholder="notion.so" validate={validateDomain} />
        </div>
      </Card>
      <Card title="Limits and policy">
        <div className="grid-2">
          <TextInput label="Max steps" type="number" min={1} max={200} value={String(skill.maxSteps)} onValueChange={(v) => patch({ maxSteps: Number(v) || 0 })} />
          <TextInput label="Timeout (minutes)" type="number" min={1} max={120} value={String(Math.round(skill.timeoutMs / 60_000))} onValueChange={(v) => patch({ timeoutMs: Math.max(0, Number(v) || 0) * 60_000 })} />
        </div>
        <div style={{ marginTop: 12 }}>
          <PolicySelect value={skill.policy.mode} onChange={(mode: ActionPolicyMode) => patch({ policy: { ...skill.policy, mode } })} />
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>
          Typing always requires approval showing the exact text, and nothing is ever sent automatically. These two rules cannot be changed in the alpha.
        </p>
      </Card>
      <Card title="Save">
        <TextInput label="Correction note (optional)" value={note} onValueChange={setNote} maxLength={500} hint="Recorded with the new version so you can see why the skill changed." />
        {errors.length > 0 ? (
          <ul className="field-error" role="alert" style={{ marginTop: 8 }}>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        ) : null}
        <div className="row" style={{ marginTop: 12 }}>
          <Button type="submit" variant="primary" busy={busy} disabled={errors.length > 0}>
            Save as version {skill.version + 1}
          </Button>
          <Button variant="ghost" onClick={() => setSkill(initial)} disabled={busy}>
            Reset changes
          </Button>
        </div>
      </Card>
    </form>
  );
}
