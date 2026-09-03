/**
 * Generic multimodal provider for any OpenAI-compatible chat endpoint. Every
 * call asks for a single JSON object, extracts it, validates it against the
 * Zod contract and throws a typed error on failure. Nothing is fabricated.
 */
import { z } from "zod";
import {
  ActionTypeSchema,
  AnalyzeEpisodeInputSchema,
  DraftSkillInputSchema,
  EpisodeAnalysisSchema,
  NextActionInputSchema,
  ProposedActionResultSchema,
  ProposedActionSchema,
  SkillDraftSchema,
  StepVerificationSchema,
  VerifyStepInputSchema,
  type AnalyzeEpisodeInput,
  type DraftSkillInput,
  type EpisodeAnalysis,
  type ModelHealth,
  type ModelImage,
  type NextActionInput,
  type ProposedActionResult,
  type SkillDraft,
  type StepVerification,
  type VerifyStepInput
} from "@apprentice/schemas";
import type { ContentBlock } from "../uimate/history.js";
import { chatCompletion, probeHealth, type HttpOptions } from "./http.js";
import { identityResizer, prepareModelImage, toDataUrl, type ImageResizer, type PreparedImage } from "./image.js";
import { extractFirstJsonObject } from "./json-extract.js";
import { SAFETY_SECTION } from "./safety.js";
import { ProviderResponseError, defaultSleep, type FetchImpl, type SleepImpl, type VisionAgentProvider } from "./types.js";

const PROVIDER = "openai_compatible" as const;
const DEFAULT_TIMEOUT_MS = 130000;
const DEFAULT_IMAGES_TO_KEEP = 2;
const DEFAULT_MAX_ATTEMPTS = 2;
const MAX_TOKENS = 2048;
const TEMPERATURE = 0.2;

export interface OpenAICompatibleProviderOptions {
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey?: string;
  readonly fetchImpl?: FetchImpl;
  readonly timeoutMs?: number;
  readonly imagesToKeep?: number;
  readonly resizeImage?: ImageResizer;
  readonly sleep?: SleepImpl;
  readonly maxAttempts?: number;
  readonly now?: () => number;
}

interface RunHistory {
  readonly sessionId: string;
  readonly screenshots: readonly PreparedImage[];
  readonly summaries: readonly string[];
}

const JSON_ONLY = "Reply with exactly one JSON object and nothing else: no prose, no code fences, no hidden reasoning.";

const ACTION_SHAPE = `Allowed "action" values (coordinates are pixels of the screenshot you were given; all fields required unless marked optional):
{"type":"click","x":number,"y":number,"button":"left"|"right"|"middle","purpose":string,"expectedResult":string,"confidence":0..1}
{"type":"double_click","x":number,"y":number,"purpose":string,"expectedResult":string,"confidence":0..1}
{"type":"move","x":number,"y":number,"purpose":string,"expectedResult":string,"confidence":0..1}
{"type":"scroll","x":number,"y":number,"deltaX":int,"deltaY":int (negative scrolls up),"purpose":string,"expectedResult":string,"confidence":0..1}
{"type":"type_text","text":string,"purpose":string,"expectedResult":string,"confidence":0..1}
{"type":"press_key","key":"enter"|"tab"|"escape"|"space"|"backspace"|"delete"|"up"|"down"|"left"|"right"|"home"|"end"|"pageup"|"pagedown"|"f1".."f12"|letter|digit,"purpose":string,"expectedResult":string,"confidence":0..1}
{"type":"hotkey","modifiers":["command"|"shift"|"alt"|"option"|"ctrl"],"key":<same as press_key>,"purpose":string,"expectedResult":string,"confidence":0..1}
{"type":"wait","ms":100..15000,"purpose":string,"expectedResult":string,"confidence":0..1}
{"type":"ask_user","question":string,"purpose":string,"expectedResult":string,"confidence":0..1}
{"type":"done","summary":string,"purpose":string,"expectedResult":string,"confidence":0..1}
{"type":"fail","reason":string,"purpose":string,"expectedResult":string,"confidence":0..1}`;

const ModelActionReplySchema = z.object({
  action: z.unknown().nullable(),
  actionSummary: z.string().max(300).default(""),
  rationale: z.string().max(500).default(""),
  controlToken: z.enum(["WAIT", "DONE", "FAIL", "SUBTASK_COMPLETE"]).optional(),
  subtaskCompleteEvidence: z.string().max(300).optional()
});

const AnalysisReplySchema = EpisodeAnalysisSchema.omit({ provider: true, latencyMs: true });
const VerifyReplySchema = StepVerificationSchema.pick({ passed: true, subtaskComplete: true, evidence: true, confidence: true });

function text(value: string): ContentBlock {
  return { type: "text", text: value };
}

function image(base64: string): ContentBlock {
  return { type: "image_url", image_url: { url: toDataUrl(base64) } };
}

function issues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

export class OpenAICompatibleVisionProvider implements VisionAgentProvider {
  private readonly http: HttpOptions;
  private readonly model: string;
  private readonly imagesToKeep: number;
  private readonly resizeImage: ImageResizer;
  private readonly now: () => number;
  private runs: ReadonlyMap<string, RunHistory> = new Map();

  constructor(options: OpenAICompatibleProviderOptions) {
    if (!options.baseUrl || !options.model) {
      throw new RangeError("OpenAICompatibleVisionProvider requires baseUrl and model");
    }
    this.http = {
      provider: PROVIDER,
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      fetchImpl: options.fetchImpl ?? fetch,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxAttempts: options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      sleep: options.sleep ?? defaultSleep
    };
    this.model = options.model;
    this.imagesToKeep = Math.max(1, options.imagesToKeep ?? DEFAULT_IMAGES_TO_KEEP);
    this.resizeImage = options.resizeImage ?? identityResizer;
    this.now = options.now ?? Date.now;
  }

  health(): Promise<ModelHealth> {
    return probeHealth({
      http: this.http,
      model: this.model,
      capabilities: { vision: true, actionPolicy: false, structuredOutput: true },
      now: this.now
    });
  }

  private async complete(system: string, user: readonly ContentBlock[]): Promise<{ readonly json: unknown; readonly latencyMs: number }> {
    const started = this.now();
    const { content: reply } = await chatCompletion(this.http, {
      model: this.model,
      messages: [
        { role: "system", content: [text(`${system}\n\n${SAFETY_SECTION}\n\n${JSON_ONLY}`)] },
        { role: "user", content: user }
      ],
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      response_format: { type: "json_object" }
    });
    const extracted = extractFirstJsonObject(reply);
    if (!extracted.ok) {
      throw new ProviderResponseError(PROVIDER, `model reply is not JSON: ${extracted.reason}`);
    }
    return { json: extracted.value, latencyMs: Math.max(0, this.now() - started) };
  }

  private async prepareAll(images: readonly ModelImage[]): Promise<readonly PreparedImage[]> {
    return Promise.all(images.map((img) => prepareModelImage(img, this.resizeImage)));
  }

  async analyzeEpisode(rawInput: AnalyzeEpisodeInput): Promise<EpisodeAnalysis> {
    const input = AnalyzeEpisodeInputSchema.parse(rawInput);
    const shots = await this.prepareAll(input.screenshots);
    const system =
      "You analyse a redacted record of a repeated desktop workflow and describe it as a reusable skill. " +
      'Return JSON with keys: goal, trigger, stepGroups [{title, tokenIndexes}], variables [{name, kind ("text"|"identifier"|"date"|"amount"|"person"|"file"|"url_path"|"unknown"), description, examples, required}], successCriteria [string], riskNotes [string], suggestedSkillName, confidence (0..1).';
    const user: ContentBlock[] = [
      text(
        `Summary:\n${input.redactedSummary}\n\nApps: ${input.apps.join(", ") || "none"}\nDomains: ${input.domains.join(", ") || "none"}\nActive duration: ${input.activeDurationMs} ms\n\nAction tokens (index: token):\n${input.actionTokens.map((t, i) => `${i}: ${t}`).join("\n")}`
      ),
      ...shots.map((s) => image(s.base64))
    ];
    const { json, latencyMs } = await this.complete(system, user);
    const parsed = AnalysisReplySchema.safeParse(json);
    if (!parsed.success) {
      throw new ProviderResponseError(PROVIDER, "episode analysis failed schema validation", issues(parsed.error));
    }
    return EpisodeAnalysisSchema.parse({ ...parsed.data, provider: PROVIDER, latencyMs });
  }

  async draftSkill(rawInput: DraftSkillInput): Promise<SkillDraft> {
    const input = DraftSkillInputSchema.parse(rawInput);
    const shots = await this.prepareAll(input.screenshots);
    const system =
      "You refine a deterministic skill draft for a desktop work agent. Keep the subtask structure, improve names, goals, completion criteria and key steps. " +
      "Return JSON with the same keys as the draft: name, description, goal, trigger, subtasks [{title, goal, completionCriteria, keySteps, appOrDomain}], variables, successCriteria, riskNotes, allowedApps, allowedDomains, confidence.";
    const user: ContentBlock[] = [
      text(`Draft:\n${JSON.stringify(input.deterministicDraft)}\n\nSummary:\n${input.redactedSummary}\n\nAction tokens:\n${input.actionTokens.join("\n")}`),
      ...shots.map((s) => image(s.base64))
    ];
    const { json } = await this.complete(system, user);
    const parsed = SkillDraftSchema.safeParse({ ...(typeof json === "object" && json !== null ? json : {}), origin: "model_refined" });
    if (!parsed.success) {
      throw new ProviderResponseError(PROVIDER, "skill draft failed schema validation", issues(parsed.error));
    }
    return parsed.data;
  }

  private historyFor(input: NextActionInput): RunHistory {
    return this.runs.get(input.runId) ?? { sessionId: input.sessionId, screenshots: [], summaries: [] };
  }

  private remember(runId: string, history: RunHistory, shot: PreparedImage, summary: string): void {
    const next: RunHistory = {
      ...history,
      screenshots: [...history.screenshots, shot].slice(-this.imagesToKeep),
      summaries: [...history.summaries, summary].slice(-50)
    };
    this.runs = new Map([...this.runs, [runId, next]]);
  }

  private buildActionResult(json: unknown, shot: PreparedImage, input: NextActionInput, latencyMs: number): ProposedActionResult {
    const reply = ModelActionReplySchema.safeParse(json);
    if (!reply.success) {
      throw new ProviderResponseError(PROVIDER, "next-action reply failed schema validation", issues(reply.error));
    }
    const base = {
      actionSummary: reply.data.actionSummary,
      rationale: reply.data.rationale,
      ...(reply.data.controlToken !== undefined ? { controlToken: reply.data.controlToken } : {}),
      ...(reply.data.subtaskCompleteEvidence !== undefined ? { subtaskCompleteEvidence: reply.data.subtaskCompleteEvidence } : {}),
      latencyMs,
      provider: PROVIDER
    };
    const raw = reply.data.action;
    if (raw === null || raw === undefined) {
      return ProposedActionResultSchema.parse({ ...base, action: null, parseErrors: [] });
    }
    if (typeof raw !== "object") {
      return ProposedActionResultSchema.parse({ ...base, action: null, parseErrors: ["action is not an object"] });
    }
    const candidateType = (raw as { type?: unknown }).type;
    if (!ActionTypeSchema.safeParse(candidateType).success) {
      return ProposedActionResultSchema.parse({ ...base, action: null, parseErrors: [`unsupported action type ${JSON.stringify(candidateType)}`] });
    }
    const candidate = {
      purpose: reply.data.actionSummary || "Model proposed action",
      expectedResult: "The screen reflects the action",
      confidence: 0.5,
      ...(raw as Record<string, unknown>),
      sourceScreenshot: {
        ...(input.screenshot.id !== undefined ? { screenshotId: input.screenshot.id } : {}),
        width: shot.width,
        height: shot.height
      },
      subtaskIndex: input.currentSubtaskIndex
    };
    const action = ProposedActionSchema.safeParse(candidate);
    if (!action.success) {
      return ProposedActionResultSchema.parse({ ...base, action: null, parseErrors: issues(action.error).slice(0, 10) });
    }
    return ProposedActionResultSchema.parse({ ...base, action: action.data, parseErrors: [] });
  }

  async proposeNextAction(rawInput: NextActionInput): Promise<ProposedActionResult> {
    const input = NextActionInputSchema.parse(rawInput);
    const history = this.historyFor(input);
    const shot = await prepareModelImage(input.screenshot, this.resizeImage);
    const subtask = input.skill.subtasks[input.currentSubtaskIndex];
    const system =
      "You are the action policy of a desktop work agent on macOS. Given the current screenshot, the skill and the current subtask, propose exactly one next action as JSON: " +
      '{"action": <action object or null>, "actionSummary": string, "rationale": string, "controlToken"?: "WAIT"|"DONE"|"FAIL"|"SUBTASK_COMPLETE", "subtaskCompleteEvidence"?: string}. ' +
      "Use controlToken SUBTASK_COMPLETE with evidence when the screenshot already satisfies the completion criteria, DONE when the whole task is finished, FAIL when it is infeasible.\n\n" +
      ACTION_SHAPE;
    const previous = history.screenshots.slice(-(this.imagesToKeep - 1));
    const user: ContentBlock[] = [
      text(
        `Skill: ${input.skill.name}\nInstruction: ${input.instruction}\n\nSubtasks:\n${input.skill.subtasks
          .map((s, i) => `${i === input.currentSubtaskIndex ? ">" : " "} ${i}: ${s.title} - ${s.goal} (done when: ${s.completionCriteria})`)
          .join("\n")}\n\nCurrent subtask ${input.currentSubtaskIndex}: ${subtask?.goal ?? ""}\nKey steps:\n${(subtask?.keySteps ?? []).map((k, i) => `${i + 1}. ${k}`).join("\n") || "None"}\n\nPrior actions:\n${input.priorActions.map((a) => `${a.stepIndex}: ${a.summary}`).join("\n") || "None"}\n\nVariables: ${JSON.stringify(input.variables)}\n\nScreenshot size: ${shot.width}x${shot.height} px.`
      ),
      ...previous.map((p) => image(p.base64)),
      text("Current screenshot:"),
      image(shot.base64)
    ];
    const { json, latencyMs } = await this.complete(system, user);
    const result = this.buildActionResult(json, shot, input, latencyMs);
    this.remember(input.runId, history, shot, result.actionSummary);
    return result;
  }

  async verifyStep(rawInput: VerifyStepInput): Promise<StepVerification> {
    const input = VerifyStepInputSchema.parse(rawInput);
    const after = await prepareModelImage(input.after, this.resizeImage);
    const before = input.before ? await prepareModelImage(input.before, this.resizeImage) : null;
    const system =
      "You compare screenshots taken before and after a desktop action and judge whether the expected result is visible. " +
      "This is supporting evidence only. Return JSON: {passed: boolean, subtaskComplete: boolean, evidence: string, confidence: 0..1}.";
    const user: ContentBlock[] = [
      text(`Expected result: ${input.expectedResult}\nSubtask completion criteria: ${input.completionCriteria}\nOCR diff: ${JSON.stringify(input.ocrDiff ?? { added: [], removed: [] })}`),
      ...(before ? [text("Before:"), image(before.base64)] : []),
      text("After:"),
      image(after.base64)
    ];
    const { json } = await this.complete(system, user);
    const parsed = VerifyReplySchema.safeParse(json);
    if (!parsed.success) {
      throw new ProviderResponseError(PROVIDER, "verification reply failed schema validation", issues(parsed.error));
    }
    return StepVerificationSchema.parse({ ...parsed.data, method: "model_supporting" });
  }

  resetSession(sessionId: string): Promise<void> {
    this.runs = new Map([...this.runs].filter(([runId, history]) => runId !== sessionId && history.sessionId !== sessionId));
    return Promise.resolve();
  }
}
