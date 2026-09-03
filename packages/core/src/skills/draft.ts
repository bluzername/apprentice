import type { ActivityEvent, CompletionPredicate, Episode, ScreenshotRecord, SkillDraft, VariableSlot, WorkflowCandidate } from "@apprentice/schemas";
import { humanizeToken } from "../humanize.js";
import { eventContext, isOutcomeEvent } from "../episodes/boundaries.js";
import { eventToToken, parseToken, tokenContext } from "../normalize/token.js";
import { redactText } from "../redaction/redact-text.js";
import { riskClassRank } from "../risk/dictionaries.js";
import { tokenRiskClass } from "../risk/token-risk.js";
import { detectVariables } from "../candidates/variables.js";
import { changedTitlePart, contextEvidence, timelineEvidence, type DraftEvidence, type GroupRange } from "./evidence.js";
import { groupByContext, type TokenEntry, type TokenGroup } from "./group.js";
import { anchorEntry, outcomeEntry } from "./outcome.js";

export interface DraftSubtask {
  title: string;
  goal: string;
  completionCriteria: string;
  keySteps: string[];
  appOrDomain?: string;
  completionPredicates: CompletionPredicate[];
}

/** Deterministic draft: a SkillDraft whose subtasks also carry completion predicates. */
export interface CoreSkillDraft extends Omit<SkillDraft, "subtasks"> {
  subtasks: DraftSubtask[];
}

const MAX_KEY_STEPS = 20;

function groupRange(group: TokenGroup, next: TokenGroup | undefined): GroupRange {
  const nextStart = next?.entries[0]?.ts;
  return {
    context: group.context,
    startTs: group.entries[0]!.ts,
    endTs: group.entries[group.entries.length - 1]!.ts,
    ...(nextStart === undefined ? {} : { nextStartTs: nextStart })
  };
}

/** The bundle id the workflow moves to once this group is done, when that is another app. */
function appSwitchTarget(group: TokenGroup, next: TokenGroup | undefined, evidence: DraftEvidence): string | undefined {
  if (next === undefined || next.context === group.context) return undefined;
  const target = evidence.bundleIdFor(next.context);
  return target === undefined || target === evidence.bundleIdFor(group.context) ? undefined : target;
}

/**
 * Completion predicates from what was actually recorded: the route the group
 * navigated to, a switch to another app, and the title left on screen after the
 * group's last action. `user_confirm` is the last resort and means only the
 * user can say this subtask is done.
 */
function predicatesFor(group: TokenGroup, next: TokenGroup | undefined, evidence: DraftEvidence): CompletionPredicate[] {
  const last = group.entries[group.entries.length - 1]!;
  const parts = parseToken(last.token);
  const route: CompletionPredicate[] =
    parts["action"] === "navigate" && parts["route"] !== undefined ? [{ kind: "url_pattern", pattern: `${parts["domain"] ?? ""}${parts["route"]}`.slice(0, 256) }] : [];
  const switched = appSwitchTarget(group, next, evidence);
  const frontmost: CompletionPredicate[] = switched === undefined ? [] : [{ kind: "app_frontmost", bundleId: switched.slice(0, 256) }];
  const observed = evidence.titleAfter(groupRange(group, next));
  const titleText = observed === undefined ? "" : redactText(changedTitlePart(observed.after, observed.before)).text.trim().slice(0, 160);
  const title: CompletionPredicate[] = titleText.length > 0 ? [{ kind: "title_contains", text: titleText }] : [];
  const derived = [...route, ...frontmost, ...title];
  return derived.length > 0 ? derived : [{ kind: "user_confirm" }];
}

function subtaskFromGroup(group: TokenGroup, index: number, next: TokenGroup | undefined, evidence: DraftEvidence): DraftSubtask {
  const steps = group.entries.map((entry) => humanizeToken(entry.token));
  const anchor = humanizeToken(anchorEntry(group.entries).token);
  const context = group.context;
  return {
    title: `${index + 1}. ${anchor} on ${context}`.slice(0, 120),
    goal: `Work in ${context} until you have completed: ${anchor.toLowerCase()}`.slice(0, 500),
    completionCriteria: `${anchor} has visibly succeeded on ${context}`.slice(0, 500),
    keySteps: steps.slice(0, MAX_KEY_STEPS).map((step) => step.slice(0, 300)),
    appOrDomain: context,
    completionPredicates: predicatesFor(group, next, evidence)
  };
}

function riskNotesFor(tokens: readonly string[]): string[] {
  const notes = tokens
    .filter((token) => riskClassRank(tokenRiskClass(token)) >= riskClassRank("external_communication"))
    .map((token) => `${humanizeToken(token)} is classified ${tokenRiskClass(token)} and always needs approval`);
  return [...new Set(notes)].slice(0, 10).map((note) => note.slice(0, 300));
}

function successCriteriaFor(events: readonly ActivityEvent[]): string[] {
  const outcomes = events
    .filter((event) => isOutcomeEvent(event))
    .map((event) => eventToToken(event))
    .filter((token): token is string => token !== null)
    .map((token) => `${humanizeToken(token)} completed${tokenContext(token) !== undefined ? ` on ${tokenContext(token)}` : ""}`);
  return [...new Set(outcomes)].slice(0, 10).map((criterion) => criterion.slice(0, 300));
}

export interface DraftFromEventsOptions {
  readonly name?: string;
  readonly trigger?: string;
}

/**
 * Name and goal come from the last strong outcome (submit, download, save, send).
 * Closing actions and plain shortcuts never describe the goal; without an outcome
 * the draft falls back to "Work in <contexts>".
 */
function nameAndGoal(entries: readonly TokenEntry[], contexts: readonly string[]): { name: string; goal: string } {
  const outcome = outcomeEntry(entries);
  const workIn = `Work in ${contexts.join(", ")}`;
  if (outcome === undefined) return { name: workIn, goal: `${workIn} until the recorded steps are complete` };
  const action = humanizeToken(outcome.token);
  return { name: `${outcome.context}: ${action}`, goal: `${action} has visibly succeeded on ${outcome.context}` };
}

/** Deterministic skill draft from a taught event range. */
export function draftSkillFromEvents(events: readonly ActivityEvent[], options: DraftFromEventsOptions = {}): CoreSkillDraft {
  const sorted = [...events].sort((a, b) => a.ts - b.ts || a.seq - b.seq);
  const entries: TokenEntry[] = sorted
    .map((event) => ({ token: eventToToken(event), ts: event.ts, context: eventContext(event) ?? "unknown" }))
    .filter((entry): entry is TokenEntry => entry.token !== null);
  if (entries.length === 0) throw new Error("draftSkillFromEvents: no action events in range");
  const groups = groupByContext(entries);
  const evidence = timelineEvidence(sorted);
  const subtasks = groups.map((group, index) => subtaskFromGroup(group, index, groups[index + 1], evidence));
  const tokens = entries.map((entry) => entry.token);
  const first = entries[0]!;
  const contexts = [...new Set(entries.map((entry) => entry.context))];
  const { name, goal } = nameAndGoal(entries, contexts);
  const apps = [...new Set(sorted.map((event) => event.app?.bundleId).filter((id): id is string => id !== undefined))];
  const domains = [...new Set(sorted.map((event) => event.domain?.toLowerCase()).filter((d): d is string => d !== undefined))];
  return {
    name: (options.name ?? name).slice(0, 120),
    description: `Taught workflow across ${contexts.join(", ")} with ${entries.length} recorded actions.`.slice(0, 1000),
    goal: goal.slice(0, 500),
    trigger: (options.trigger ?? `When you ${humanizeToken(first.token).toLowerCase()} on ${first.context}`).slice(0, 500),
    subtasks,
    variables: detectVariables(tokens, [tokens]),
    successCriteria: successCriteriaFor(sorted),
    riskNotes: riskNotesFor(tokens),
    allowedApps: apps,
    allowedDomains: domains,
    origin: "deterministic",
    confidence: 0.5
  };
}

/**
 * Deterministic skill draft from a candidate and its evidence episodes.
 * `evidenceEvents` are the recorded events behind those episodes; without them
 * the subtasks fall back to `user_confirm`.
 */
export function draftSkillFromCandidate(candidate: WorkflowCandidate, episodes: readonly Episode[], evidenceEvents: readonly ActivityEvent[] = []): CoreSkillDraft {
  if (candidate.steps.length === 0) throw new Error("draftSkillFromCandidate: candidate has no steps");
  const entries: TokenEntry[] = candidate.steps.map((step) => ({ token: step.token, ts: step.index, context: step.appOrDomain ?? "unknown" }));
  const groups = groupByContext(entries);
  const evidence = contextEvidence(evidenceEvents);
  const subtasks = groups.map((group, index) => subtaskFromGroup(group, index, groups[index + 1], evidence));
  const evidenceEpisodes = episodes.filter((episode) => candidate.evidenceEpisodeIds.includes(episode.id));
  const sequences = evidenceEpisodes.map((episode) => episode.actionTokens);
  const tokens = candidate.steps.map((step) => step.token);
  const variables: VariableSlot[] = candidate.variables.length > 0 ? [...candidate.variables] : detectVariables(tokens, sequences);
  return {
    name: (candidate.refinedTitle ?? candidate.deterministicTitle).slice(0, 120),
    description: (candidate.refinedDescription ?? candidate.confidenceExplanation).slice(0, 1000),
    goal: candidate.expectedOutcome.slice(0, 500),
    trigger: candidate.trigger.slice(0, 500),
    subtasks,
    variables,
    successCriteria: [`${candidate.expectedOutcome} completed`.slice(0, 300)],
    riskNotes: riskNotesFor(tokens),
    allowedApps: [...candidate.apps],
    allowedDomains: [...candidate.domains],
    origin: "deterministic",
    confidence: candidate.confidence
  };
}

export interface RetentionPreview {
  readonly eventCount: number;
  readonly screenshotCount: number;
  readonly fields: readonly string[];
}

/** Exactly what saving a taught skill would retain. */
export function skillRetentionPreview(draft: SkillDraft, events: readonly ActivityEvent[], screenshots: readonly ScreenshotRecord[]): RetentionPreview {
  const fields = new Set<string>(["skill.name", "skill.trigger", "skill.subtasks", "skill.successCriteria"]);
  if (draft.variables.length > 0) fields.add("skill.variables");
  if (draft.riskNotes.length > 0) fields.add("skill.riskNotes");
  for (const event of events) {
    fields.add("event.type");
    fields.add("event.ts");
    if (event.app !== undefined) fields.add("event.app");
    if (event.domain !== undefined) fields.add("event.domain");
    if (event.routePattern !== undefined) fields.add("event.routePattern");
    if (event.element?.role !== undefined) fields.add("event.element.role");
    if (event.element?.name !== undefined || event.element?.ariaLabel !== undefined || event.element?.text !== undefined) fields.add("event.element.label");
    if (event.payload?.["title"] !== undefined) fields.add("event.payload.title");
    if (event.payload?.["keys"] !== undefined) fields.add("event.payload.keys");
  }
  if (screenshots.length > 0) {
    fields.add("screenshot.encryptedPng");
    fields.add("screenshot.perceptualHash");
    fields.add("screenshot.dimensions");
  }
  return { eventCount: events.length, screenshotCount: screenshots.length, fields: [...fields].sort() };
}
