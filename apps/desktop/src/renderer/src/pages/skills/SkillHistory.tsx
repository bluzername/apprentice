import type { JSX } from "react";
import type { Skill } from "@apprentice/schemas";
import { Card } from "../../components/Card";
import { formatDateTime } from "../../lib/format";

/** Summarises which fields changed between two versions. */
export function diffSummary(previous: Skill, next: Skill): string[] {
  const changes: string[] = [];
  if (previous.name !== next.name) changes.push("name");
  if (previous.trigger !== next.trigger) changes.push("trigger");
  if (previous.description !== next.description) changes.push("description");
  if (previous.subtasks.length !== next.subtasks.length) changes.push(`subtasks (${previous.subtasks.length} to ${next.subtasks.length})`);
  else if (JSON.stringify(previous.subtasks) !== JSON.stringify(next.subtasks)) changes.push("subtask details");
  if (JSON.stringify(previous.variables) !== JSON.stringify(next.variables)) changes.push("variables");
  if (JSON.stringify(previous.successCriteria) !== JSON.stringify(next.successCriteria)) changes.push("success criteria");
  if (JSON.stringify(previous.allowedApps) !== JSON.stringify(next.allowedApps) || JSON.stringify(previous.allowedDomains) !== JSON.stringify(next.allowedDomains)) changes.push("scope");
  if (previous.policy.mode !== next.policy.mode) changes.push(`policy (${previous.policy.mode} to ${next.policy.mode})`);
  if (previous.maxSteps !== next.maxSteps || previous.timeoutMs !== next.timeoutMs) changes.push("limits");
  return changes;
}

export function SkillHistory({ skill, history }: { skill: Skill; history: Skill[] }): JSX.Element {
  const versions = [...history, skill].sort((a, b) => a.version - b.version);
  return (
    <div className="stack">
      <Card title="Version history">
        {versions.length <= 1 ? <p className="muted">Only one version so far.</p> : null}
        <ol className="stack-sm" style={{ paddingLeft: "1.2rem" }}>
          {versions.map((v, i) => {
            const previous = versions[i - 1];
            const changes = previous ? diffSummary(previous, v) : [];
            return (
              <li key={v.version}>
                <strong>Version {v.version}</strong> <span className="small muted">{formatDateTime(v.updatedAt)}</span>
                <div className="small">{previous ? (changes.length > 0 ? `Changed: ${changes.join(", ")}` : "No visible field changes") : `Created from ${v.source}`}</div>
              </li>
            );
          })}
        </ol>
      </Card>
      <Card title="Corrections">
        {skill.corrections.length === 0 ? <p className="muted">No corrections recorded yet.</p> : null}
        <ul className="stack-sm">
          {skill.corrections.map((c, i) => (
            <li key={i}>
              <span className="small muted">{formatDateTime(c.ts)}, from v{c.fromVersion}, field {c.field}:</span> {c.note}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
