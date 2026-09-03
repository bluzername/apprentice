/**
 * UI-Mate action policy provider. Follows the official demonstration-guided
 * protocol (prompt, message history, response parser, control tokens) ported
 * under src/uimate from Tencent/UI-Mate at commit 1cb9e1e (Apache-2.0).
 *
 * Deviations from the reference agent, all documented in README.md:
 * 1. Apprentice's "# Safety" section is appended AFTER the official workflow
 *    section of the system prompt (spec 11.3). The official text itself is
 *    untouched and byte-identical up to that point.
 * 2. Hidden reasoning is never stored: history replays each past response from
 *    `<action>` onwards (the reference agent's include_thinking_in_history=False
 *    configuration), so no `<think>` text lives in session state.
 * 3. The subtask pointer follows the app's `currentSubtaskIndex` (the runtime
 *    is authoritative, spec 11.4); the pointer's await-finish flag is kept here.
 * 4. Analysis calls (analyzeEpisode/draftSkill/verifyStep) fail over to a
 *    configured fallback or throw ProviderCapabilityError; UI-Mate is a GUI
 *    action policy, not a JSON chat model.
 * 5. A reply cut off at max_tokens (finish_reason "length") is reported as a
 *    parse error with no action and no control token, so the run engine retries
 *    the step instead of reading the truncated text as DONE or FAIL.
 * 6. Sampling (temperature, top_p, enable_thinking) is configurable; the
 *    defaults stay the official evaluation values when no option is given.
 * 7. When `platform` is "macos" the two Ubuntu-specific system prompt fragments
 *    are replaced by macOS text (see uimate/constants.ts).
 */
import {
  NextActionInputSchema,
  ProposedActionResultSchema,
  type AnalyzeEpisodeInput,
  type ControlToken,
  type DraftSkillInput,
  type EpisodeAnalysis,
  type ModelHealth,
  type NextActionInput,
  type ProposedAction,
  type ProposedActionResult,
  type SkillDraft,
  type StepVerification,
  type VerifyStepInput
} from "@apprentice/schemas";
import {
  COLLAPSED_SCREENSHOT_TEXT,
  DEFAULT_API_KEY,
  DEFAULT_HISTORY_N,
  DEFAULT_IMAGES_TO_KEEP,
  DEFAULT_MAX_RETRY_TIMES,
  DEFAULT_MAX_TOKENS,
  DEFAULT_MODEL,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_TEMPERATURE,
  DEFAULT_TOP_P,
  type CoordinateType,
  type PromptPlatform
} from "../uimate/constants.js";
import { buildMessages, collapseMessages, releaseOutOfWindowScreenshots } from "../uimate/history.js";
import { UIMateParseError, compactResponseForHistory, parseResponse, type ParsedResponse } from "../uimate/parser.js";
import { translateResponse, type TranslationResult } from "../uimate/translate.js";
import {
  INITIAL_WORKFLOW_POINTER,
  SUBTASK_COMPLETE_PATCH,
  WORKFLOW_SYSTEM_SECTION,
  buildGuidance,
  planFromSkillSubtasks,
  workflowAfterPredict,
  type WorkflowPlan,
  type WorkflowPointerResult,
  type WorkflowPointerState
} from "../uimate/workflow.js";
import { chatCompletion, probeHealth, type ChatCompletionResult, type HttpOptions } from "./http.js";
import { identityResizer, prepareModelImage, type ImageResizer, type PreparedImage } from "./image.js";
import { stripThinkBlocks } from "./json-extract.js";
import { SAFETY_SECTION } from "./safety.js";
import { ProviderCapabilityError, defaultSleep, type FetchImpl, type SleepImpl, type VisionAgentProvider } from "./types.js";

const PROVIDER = "uimate" as const;

export interface UIMateProviderOptions {
  readonly baseUrl: string;
  readonly model?: string;
  readonly apiKey?: string;
  readonly fetchImpl?: FetchImpl;
  readonly timeoutMs?: number;
  readonly imagesToKeep?: number;
  readonly coordinateType?: CoordinateType;
  /** chat_template_kwargs.enable_thinking; official default true. */
  readonly enableThinking?: boolean;
  /** Sampling temperature; official evaluation default 1.0. */
  readonly temperature?: number;
  /** Nucleus sampling cutoff; official evaluation default 0.95. */
  readonly topP?: number;
  readonly remapControlToCommand?: boolean;
  readonly fallback?: VisionAgentProvider;
  readonly resizeImage?: ImageResizer;
  readonly historyN?: number;
  /** Reply token cap sent as max_tokens (official default 16384; the desktop app bounds it so one step cannot take minutes). */
  readonly maxTokens?: number;
  readonly maxAttempts?: number;
  readonly sleep?: SleepImpl;
  readonly now?: () => number;
}

interface UIMateSession {
  readonly sessionId: string;
  /** Base64 PNGs the model saw (null once released from the history window). */
  readonly screenshots: readonly (string | null)[];
  /** Past responses compacted from `<action>` onwards; never contain `<think>`. */
  readonly responses: readonly string[];
  readonly actions: readonly string[];
  readonly pointer: WorkflowPointerState;
  readonly lastPointer?: { readonly x: number; readonly y: number };
}

const EMPTY_SESSION = (sessionId: string): UIMateSession => ({
  sessionId,
  screenshots: [],
  responses: [],
  actions: [],
  pointer: INITIAL_WORKFLOW_POINTER
});

/** Official workflow section followed by Apprentice's safety section (deviation 1). */
export const UIMATE_WORKFLOW_SECTION_WITH_SAFETY = `${WORKFLOW_SYSTEM_SECTION}\n\n${SAFETY_SECTION}`;

const CAPABILITY_MESSAGE = "UI-Mate is a GUI action policy; configure a generic multimodal provider for analysis";

/** Reported as a parse error when the server stopped generation at max_tokens. */
export const TRUNCATED_REPLY_ERROR = "reply truncated at max_tokens";

function promptPlatform(input: NextActionInput): PromptPlatform {
  return input.platform === "macos" ? "macos" : "ubuntu";
}

/**
 * History replay text for one past response: from `<action>` onwards, with any
 * `<think>` block or dangling `</think>` prefix removed (deviation 2).
 */
export function sanitizeForHistory(response: string): string {
  const compact = stripThinkBlocks(compactResponseForHistory(response, false));
  const closing = compact.lastIndexOf("</think>");
  return closing === -1 ? compact : compact.slice(closing + "</think>".length).trimStart();
}

function pointerFromAction(action: ProposedAction | null): { readonly x: number; readonly y: number } | undefined {
  if (action && (action.type === "click" || action.type === "double_click" || action.type === "move" || action.type === "scroll")) {
    return { x: action.x, y: action.y };
  }
  return undefined;
}

interface Composed {
  readonly action: ProposedAction | null;
  readonly actionSummary: string;
  readonly rationale: string;
  readonly controlToken?: ControlToken;
  readonly subtaskCompleteEvidence?: string;
  readonly parseErrors: readonly string[];
}

/** Fold the workflow pointer outcome into the translated result. */
function composeResult(translation: TranslationResult, pointer: WorkflowPointerResult, parseErrors: readonly string[]): Composed {
  const errors = [...translation.parseErrors, ...parseErrors];
  if (pointer.subtaskCompleteDetected) {
    const finishedAfterAwait = pointer.actions.length === 1 && pointer.actions[0] === "DONE";
    return {
      action: null,
      actionSummary: translation.actionSummary,
      rationale: translation.rationale,
      controlToken: finishedAfterAwait ? "DONE" : "SUBTASK_COMPLETE",
      subtaskCompleteEvidence: translation.subtaskCompleteEvidence ?? "The model reported the current subtask complete.",
      parseErrors: errors
    };
  }
  if (pointer.earlyDoneRewritten) {
    return {
      action: null,
      actionSummary: translation.actionSummary,
      rationale: translation.rationale,
      controlToken: "SUBTASK_COMPLETE",
      subtaskCompleteEvidence: "The model reported the task finished before the final subtask; treated as subtask completion (official workflow rule).",
      parseErrors: errors
    };
  }
  return { ...translation, parseErrors: errors };
}

export class UIMateProvider implements VisionAgentProvider {
  private readonly http: HttpOptions;
  private readonly model: string;
  private readonly imagesToKeep: number;
  private readonly coordinateType: CoordinateType;
  private readonly enableThinking: boolean;
  private readonly temperature: number;
  private readonly topP: number;
  private readonly remapControlToCommand: boolean;
  private readonly fallback: VisionAgentProvider | undefined;
  private readonly resizeImage: ImageResizer;
  private readonly historyN: number;
  private readonly maxTokens: number;
  private readonly now: () => number;
  private sessions: ReadonlyMap<string, UIMateSession> = new Map();

  constructor(options: UIMateProviderOptions) {
    if (!options.baseUrl) {
      throw new RangeError("UIMateProvider requires baseUrl");
    }
    const imagesToKeep = options.imagesToKeep ?? DEFAULT_IMAGES_TO_KEEP;
    if (imagesToKeep < 1) {
      throw new RangeError("imagesToKeep must be >= 1");
    }
    this.http = {
      provider: PROVIDER,
      baseUrl: options.baseUrl,
      apiKey: options.apiKey ?? DEFAULT_API_KEY,
      fetchImpl: options.fetchImpl ?? fetch,
      timeoutMs: options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      maxAttempts: options.maxAttempts ?? DEFAULT_MAX_RETRY_TIMES,
      sleep: options.sleep ?? defaultSleep
    };
    this.model = options.model ?? DEFAULT_MODEL;
    this.imagesToKeep = imagesToKeep;
    this.coordinateType = options.coordinateType ?? "relative";
    this.enableThinking = options.enableThinking ?? true;
    if (options.temperature !== undefined && (!Number.isFinite(options.temperature) || options.temperature < 0 || options.temperature > 2)) {
      throw new RangeError("temperature must be between 0 and 2");
    }
    this.temperature = options.temperature ?? DEFAULT_TEMPERATURE;
    if (options.topP !== undefined && (!Number.isFinite(options.topP) || options.topP <= 0 || options.topP > 1)) {
      throw new RangeError("topP must be greater than 0 and at most 1");
    }
    this.topP = options.topP ?? DEFAULT_TOP_P;
    this.remapControlToCommand = options.remapControlToCommand ?? true;
    this.fallback = options.fallback;
    this.resizeImage = options.resizeImage ?? identityResizer;
    this.historyN = options.historyN ?? DEFAULT_HISTORY_N;
    if (options.maxTokens !== undefined && (!Number.isInteger(options.maxTokens) || options.maxTokens < 256)) {
      throw new RangeError("maxTokens must be an integer of at least 256");
    }
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.now = options.now ?? Date.now;
  }

  health(): Promise<ModelHealth> {
    return probeHealth({
      http: this.http,
      model: this.model,
      capabilities: { vision: true, actionPolicy: true, structuredOutput: false },
      now: this.now
    });
  }

  analyzeEpisode(input: AnalyzeEpisodeInput): Promise<EpisodeAnalysis> {
    if (this.fallback) {
      return this.fallback.analyzeEpisode(input);
    }
    return Promise.reject(new ProviderCapabilityError(PROVIDER, CAPABILITY_MESSAGE));
  }

  draftSkill(input: DraftSkillInput): Promise<SkillDraft> {
    if (this.fallback) {
      return this.fallback.draftSkill(input);
    }
    return Promise.reject(new ProviderCapabilityError(PROVIDER, CAPABILITY_MESSAGE));
  }

  verifyStep(input: VerifyStepInput): Promise<StepVerification> {
    if (this.fallback) {
      return this.fallback.verifyStep(input);
    }
    return Promise.reject(new ProviderCapabilityError(PROVIDER, CAPABILITY_MESSAGE));
  }

  /** Session snapshot for tests and diagnostics (no hidden reasoning inside). */
  sessionState(runId: string): UIMateSession | undefined {
    return this.sessions.get(runId);
  }

  private planFor(input: NextActionInput): { readonly plan: WorkflowPlan; readonly index: number } {
    const plan = planFromSkillSubtasks(input.skill.subtasks);
    if (input.currentSubtaskIndex >= plan.subtasks.length) {
      throw new RangeError(`currentSubtaskIndex ${input.currentSubtaskIndex} is out of range for ${plan.subtasks.length} subtask(s)`);
    }
    return { plan, index: input.currentSubtaskIndex };
  }

  private async callModel(session: UIMateSession, plan: WorkflowPlan, index: number, input: NextActionInput, shot: PreparedImage): Promise<ChatCompletionResult> {
    const screenshots = releaseOutOfWindowScreenshots([...session.screenshots, shot.base64], this.historyN);
    const messages = buildMessages({
      instruction: input.instruction,
      screenshots,
      responses: session.responses,
      actions: session.actions,
      historyN: this.historyN,
      includeThinkingInHistory: false,
      recentThinkSteps: null,
      collapseText: COLLAPSED_SCREENSHOT_TEXT,
      guidance: buildGuidance(plan, index),
      workflowSection: UIMATE_WORKFLOW_SECTION_WITH_SAFETY,
      actionPatch: SUBTASK_COMPLETE_PATCH,
      platform: promptPlatform(input)
    });
    const { messages: collapsed } = collapseMessages(messages, this.imagesToKeep, 1, COLLAPSED_SCREENSHOT_TEXT);
    return chatCompletion(this.http, {
      model: this.model,
      messages: collapsed,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      top_p: this.topP,
      chat_template_kwargs: { enable_thinking: this.enableThinking }
    });
  }

  private parse(response: string, shot: PreparedImage): { readonly parsed: ParsedResponse; readonly errors: readonly string[] } {
    try {
      return { parsed: parseResponse(response, shot.width, shot.height, this.coordinateType), errors: [] };
    } catch (error: unknown) {
      if (error instanceof UIMateParseError || error instanceof TypeError || error instanceof RangeError) {
        return {
          parsed: { instruction: "<Error>: unparseable tool call", codes: ["FAIL"] },
          errors: [`official parser rejected the response: ${error.message}`.slice(0, 300)]
        };
      }
      throw error;
    }
  }

  async proposeNextAction(rawInput: NextActionInput): Promise<ProposedActionResult> {
    const input = NextActionInputSchema.parse(rawInput);
    const { plan, index } = this.planFor(input);
    const session = this.sessions.get(input.runId) ?? EMPTY_SESSION(input.sessionId);
    // Deviation 3: the app's subtask index wins; keep await-finish only while it still applies.
    const pointer: WorkflowPointerState = { index, awaitFinish: session.pointer.index === index && session.pointer.awaitFinish };

    const started = this.now();
    const shot = await prepareModelImage(input.screenshot, this.resizeImage);
    const { content: response, finishReason } = await this.callModel(session, plan, index, input, shot);
    const latencyMs = Math.max(0, this.now() - started);

    if (finishReason === "length") {
      // The reply is incomplete: its `<action>` sentence and tool call cannot be
      // trusted, and a missing tool call must never read as DONE or FAIL. The
      // session is left untouched so the retry sees the same history.
      return ProposedActionResultSchema.parse({
        action: null,
        actionSummary: "",
        rationale: "",
        parseErrors: [TRUNCATED_REPLY_ERROR],
        latencyMs,
        provider: PROVIDER
      });
    }

    const { parsed, errors } = this.parse(response, shot);
    const translation = translateResponse(response, {
      width: shot.width,
      height: shot.height,
      coordinateType: this.coordinateType,
      subtaskIndex: index,
      screenshotId: input.screenshot.id,
      remapControlToCommand: this.remapControlToCommand,
      pointer: session.lastPointer
    });
    // The workflow pointer follows explicit tool calls only. The official parser
    // scores a reply that has no tool call as DONE, which the early-done rule
    // would then read as a completion claim; the translation's token does not.
    const codes = translation.controlToken === "DONE" ? ["DONE"] : [];
    const workflow = workflowAfterPredict(plan, pointer, response, codes);
    const composed = composeResult(translation, workflow, errors);

    const nextSession: UIMateSession = {
      sessionId: input.sessionId,
      screenshots: releaseOutOfWindowScreenshots([...session.screenshots, shot.base64], this.historyN),
      responses: [...session.responses, sanitizeForHistory(response)],
      actions: [...session.actions, parsed.instruction],
      pointer: { index: workflow.nextIndex, awaitFinish: workflow.awaitFinish },
      lastPointer: pointerFromAction(composed.action) ?? session.lastPointer
    };
    this.sessions = new Map([...this.sessions, [input.runId, nextSession]]);

    return ProposedActionResultSchema.parse({ ...composed, latencyMs, provider: PROVIDER });
  }

  resetSession(sessionId: string): Promise<void> {
    this.sessions = new Map([...this.sessions].filter(([runId, session]) => runId !== sessionId && session.sessionId !== sessionId));
    return Promise.resolve();
  }
}
