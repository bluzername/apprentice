/**
 * Deterministic provider for tests and demo mode. No network, no randomness:
 * every output is a pure function of the input plus the per-run call count.
 */
import {
  EpisodeAnalysisSchema,
  ProposedActionResultSchema,
  SkillDraftSchema,
  type AnalyzeEpisodeInput,
  type DraftSkillInput,
  type EpisodeAnalysis,
  type ModelHealth,
  type NextActionInput,
  type ProposedAction,
  type ProposedActionResult,
  type SkillDraft,
  type StepVerification,
  type VariableSlot,
  type VerifyStepInput
} from "@apprentice/schemas";
import type { VisionAgentProvider } from "./types.js";

const PROVIDER = "mock" as const;
const ACRONYMS: ReadonlySet<string> = new Set(["crm", "url", "pdf", "csv", "api", "ui", "id", "qa", "html", "json", "erp", "hr"]);

/** A scripted step: what proposeNextAction returns for the n-th call of a subtask. */
export type MockScriptStep = Omit<ProposedActionResult, "latencyMs" | "provider"> & { readonly latencyMs?: number };

export interface MockProviderOptions {
  /** script[subtaskIndex][callIndex]; falls through to default behaviour when absent. */
  readonly script?: readonly (readonly MockScriptStep[])[];
  readonly now?: () => number;
}

interface RunState {
  readonly sessionId: string;
  readonly callsPerSubtask: Readonly<Record<number, number>>;
}

interface TokenFields {
  readonly app: string;
  readonly domain: string;
  readonly action: string;
  readonly name: string;
  readonly route: string;
  readonly raw: string;
}

export function parseActionToken(token: string): TokenFields {
  const fields = Object.fromEntries(
    token
      .split("|")
      .map((part) => part.split(":"))
      .filter((pair) => pair.length >= 2)
      .map(([key, ...rest]) => [key ?? "", rest.join(":")])
  ) as Record<string, string>;
  return {
    app: fields["app"] ?? "",
    domain: fields["domain"] ?? "",
    action: fields["action"] ?? "",
    name: fields["name"] ?? "",
    route: fields["route"] ?? "",
    raw: token
  };
}

function describeToken(token: TokenFields): string {
  const target = token.name || token.route || token.domain || token.app;
  const verb = token.action || "step";
  return target ? `${verb} ${target}` : verb;
}

function scope(token: TokenFields): string {
  return token.domain ? `${token.app || "browser"} (${token.domain})` : token.app || "unknown app";
}

/** Sentence case with known acronyms upper-cased ("Post-meeting CRM update"). */
export function improveTitle(name: string): string {
  const words = name.trim().replace(/\s+/g, " ").split(" ").filter((w) => w.length > 0);
  const cased = words.map((word, i) => {
    const lower = word.toLowerCase();
    if (ACRONYMS.has(lower)) {
      return lower.toUpperCase();
    }
    return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
  });
  return cased.join(" ") || "Untitled skill";
}

function groupTokens(tokens: readonly TokenFields[]): EpisodeAnalysis["stepGroups"] {
  return tokens.reduce<EpisodeAnalysis["stepGroups"]>((groups, token, index) => {
    const last = groups[groups.length - 1];
    const key = scope(token);
    if (last && last.title.startsWith(key)) {
      return [...groups.slice(0, -1), { ...last, tokenIndexes: [...last.tokenIndexes, index] }];
    }
    return [...groups, { title: `${key}: ${describeToken(token)}`.slice(0, 160), tokenIndexes: [index] }];
  }, []);
}

function deriveVariables(tokens: readonly TokenFields[]): VariableSlot[] {
  const names = new Set<string>();
  for (const token of tokens) {
    for (const match of token.route.matchAll(/:([a-zA-Z_]+)/g)) {
      names.add(match[1] ?? "");
    }
  }
  return [...names]
    .filter((n) => n.length > 0)
    .slice(0, 20)
    .map((name) => ({ name, kind: "identifier" as const, description: `Path parameter ${name}`, examples: [], required: true }));
}

const OUTCOME_ACTIONS = ["form-submit", "submit", "send", "save", "create", "publish"];
const RISK_ACTIONS = ["send", "submit", "publish", "delete", "remove", "pay", "transfer", "invite"];

export class MockVisionAgentProvider implements VisionAgentProvider {
  private runs: ReadonlyMap<string, RunState> = new Map();
  private readonly options: MockProviderOptions;

  constructor(options: MockProviderOptions = {}) {
    this.options = options;
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  health(): Promise<ModelHealth> {
    return Promise.resolve({
      ok: true,
      provider: PROVIDER,
      model: "mock",
      endpoint: "memory://mock",
      latencyMs: 0,
      message: "deterministic mock provider",
      capabilities: { vision: true, actionPolicy: true, structuredOutput: true },
      checkedAt: this.now()
    });
  }

  analyzeEpisode(input: AnalyzeEpisodeInput): Promise<EpisodeAnalysis> {
    const tokens = input.actionTokens.map(parseActionToken);
    const first = tokens[0];
    const last = tokens[tokens.length - 1];
    const outcome = tokens.filter((t) => OUTCOME_ACTIONS.includes(t.action));
    const risky = tokens.filter((t) => RISK_ACTIONS.some((r) => t.action.includes(r) || t.name.includes(r)));
    const suggestedSkillName = first && last ? improveTitle(`${describeToken(first)} to ${describeToken(last)}`) : "Empty episode";
    const analysis: EpisodeAnalysis = {
      goal: first && last ? `Complete the workflow from ${describeToken(first)} to ${describeToken(last)}`.slice(0, 500) : "No actions recorded",
      trigger: first ? `Starting in ${scope(first)}`.slice(0, 500) : "Unknown trigger",
      stepGroups: groupTokens(tokens).slice(0, 30),
      variables: deriveVariables(tokens),
      successCriteria: outcome.length > 0 ? outcome.slice(0, 10).map((t) => `${describeToken(t)} completed`.slice(0, 300)) : ["The final screen matches the last recorded step"],
      riskNotes: risky.slice(0, 10).map((t) => `${describeToken(t)} leaves the app or mutates data`.slice(0, 300)),
      suggestedSkillName: suggestedSkillName.slice(0, 120),
      confidence: tokens.length >= 3 ? 0.6 : 0.3,
      provider: PROVIDER,
      latencyMs: 0
    };
    return Promise.resolve(EpisodeAnalysisSchema.parse(analysis));
  }

  draftSkill(input: DraftSkillInput): Promise<SkillDraft> {
    const draft = input.deterministicDraft;
    const refined: SkillDraft = {
      ...draft,
      name: improveTitle(draft.name).slice(0, 120),
      subtasks: draft.subtasks.map((s) => ({ ...s, title: improveTitle(s.title).slice(0, 120) })),
      origin: "model_refined",
      confidence: Math.min(1, draft.confidence + 0.1)
    };
    return Promise.resolve(SkillDraftSchema.parse(refined));
  }

  private stateFor(input: NextActionInput): RunState {
    return this.runs.get(input.runId) ?? { sessionId: input.sessionId, callsPerSubtask: {} };
  }

  private bump(runId: string, state: RunState, subtaskIndex: number): void {
    const count = state.callsPerSubtask[subtaskIndex] ?? 0;
    const next: RunState = { ...state, callsPerSubtask: { ...state.callsPerSubtask, [subtaskIndex]: count + 1 } };
    this.runs = new Map([...this.runs, [runId, next]]);
  }

  private defaultStep(input: NextActionInput, callIndex: number): Omit<ProposedActionResult, "latencyMs" | "provider"> {
    const subtaskIndex = input.currentSubtaskIndex;
    const subtask = input.skill.subtasks[subtaskIndex];
    const isLast = subtaskIndex >= input.skill.subtasks.length - 1;
    if (callIndex === 0) {
      const purpose = (subtask?.keySteps[0] ?? subtask?.goal ?? "Click the centre of the screen").slice(0, 300);
      const action: ProposedAction = {
        type: "click",
        x: Math.trunc(input.screenshot.width / 2),
        y: Math.trunc(input.screenshot.height / 2),
        button: "left",
        purpose,
        expectedResult: (subtask?.completionCriteria ?? "The screen changes").slice(0, 300),
        confidence: 0.9,
        sourceScreenshot: {
          ...(input.screenshot.id !== undefined ? { screenshotId: input.screenshot.id } : {}),
          width: input.screenshot.width,
          height: input.screenshot.height
        },
        subtaskIndex
      };
      return { action, actionSummary: purpose, rationale: `Mock step for subtask ${subtaskIndex}`, parseErrors: [] };
    }
    if (callIndex === 1 || !isLast) {
      return {
        action: null,
        actionSummary: `Subtask ${subtaskIndex} complete`,
        rationale: "Mock provider reports completion after one action",
        controlToken: "SUBTASK_COMPLETE",
        subtaskCompleteEvidence: (subtask?.completionCriteria ?? "mock evidence").slice(0, 300),
        parseErrors: []
      };
    }
    return {
      action: { type: "done", summary: "Mock run finished", purpose: "Finish the run", expectedResult: "All subtasks are complete", confidence: 0.9, sourceScreenshot: { width: input.screenshot.width, height: input.screenshot.height }, subtaskIndex },
      actionSummary: "All subtasks complete",
      rationale: "Mock provider finished the final subtask",
      controlToken: "DONE",
      parseErrors: []
    };
  }

  proposeNextAction(input: NextActionInput): Promise<ProposedActionResult> {
    const state = this.stateFor(input);
    const subtaskIndex = input.currentSubtaskIndex;
    const callIndex = state.callsPerSubtask[subtaskIndex] ?? 0;
    const scripted = this.options.script?.[subtaskIndex]?.[callIndex];
    const step: MockScriptStep = scripted ?? this.defaultStep(input, callIndex);
    this.bump(input.runId, state, subtaskIndex);
    const result: ProposedActionResult = { ...step, latencyMs: step.latencyMs ?? 0, provider: PROVIDER, parseErrors: step.parseErrors ?? [] };
    return Promise.resolve(ProposedActionResultSchema.parse(result));
  }

  verifyStep(input: VerifyStepInput): Promise<StepVerification> {
    const changed = input.before === undefined ? false : input.before.pngBase64 !== input.after.pngBase64;
    return Promise.resolve({
      passed: changed,
      subtaskComplete: false,
      method: "model_supporting",
      evidence: changed ? "The screenshot changed after the action" : "The screenshot did not change after the action",
      confidence: 0.6
    });
  }

  resetSession(sessionId: string): Promise<void> {
    this.runs = new Map([...this.runs].filter(([runId, state]) => runId !== sessionId && state.sessionId !== sessionId));
    return Promise.resolve();
  }
}
