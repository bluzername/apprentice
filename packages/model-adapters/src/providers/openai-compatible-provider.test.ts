import { describe, expect, it } from "vitest";
import { EpisodeAnalysisSchema, type NextActionInput, type SkillDraft } from "@apprentice/schemas";
import { OpenAICompatibleVisionProvider } from "./openai-compatible-provider.js";
import { ProviderResponseError, ProviderUnavailableError } from "./types.js";
import { chatReply, countImagesInBody, createFakeFetch, modelsReply, routeByPath, type RecordedRequest } from "../testing/fake-fetch.js";

const BASE_URL = "http://127.0.0.1:9000/v1/";
const IMAGE = { pngBase64: "QUJD", width: 1280, height: 800 };
const noSleep = { sleep: () => Promise.resolve() };

function providerWith(replies: readonly string[], options: Partial<ConstructorParameters<typeof OpenAICompatibleVisionProvider>[0]> = {}) {
  const fake = createFakeFetch(
    routeByPath({
      models: () => modelsReply(["llava"]),
      chat: (_request, callIndex) => chatReply(replies[Math.min(callIndex, replies.length - 1)] ?? "")
    })
  );
  const provider = new OpenAICompatibleVisionProvider({ baseUrl: BASE_URL, model: "llava", apiKey: "secret", fetchImpl: fake.fetchImpl, ...noSleep, ...options });
  return { provider, fake };
}

function systemText(request: RecordedRequest | undefined): string {
  const messages = ((request?.body as { messages?: readonly { content: readonly { text?: string }[] }[] }).messages ?? []);
  return messages[0]?.content[0]?.text ?? "";
}

const ANALYSIS = {
  goal: "Log meeting notes",
  trigger: "After a meeting",
  stepGroups: [{ title: "CRM", tokenIndexes: [0, 1] }],
  variables: [{ name: "contact", kind: "person", description: "", examples: [], required: true }],
  successCriteria: ["Activity listed"],
  riskNotes: [],
  suggestedSkillName: "Post-meeting CRM update",
  confidence: 0.8
};

function nextInput(overrides: Partial<NextActionInput> = {}): NextActionInput {
  return {
    runId: "run_1",
    sessionId: "session_1",
    instruction: "Do it",
    skill: { name: "S", subtasks: [{ title: "T", goal: "G", completionCriteria: "C", keySteps: ["k"] }] },
    currentSubtaskIndex: 0,
    priorActions: [{ stepIndex: 0, summary: "clicked" }],
    screenshot: { id: "shot_9", ...IMAGE },
    platform: "macos",
    variables: { contact: "x" },
    ...overrides
  };
}

describe("OpenAICompatibleVisionProvider", () => {
  it("analyzes an episode from JSON embedded in prose and includes the safety instruction and images", async () => {
    const { provider, fake } = providerWith([`Sure, here it is:\n\`\`\`json\n${JSON.stringify(ANALYSIS)}\n\`\`\``]);
    const result = await provider.analyzeEpisode({
      episodeId: "ep",
      redactedSummary: "summary",
      actionTokens: ["a", "b"],
      apps: ["chrome"],
      domains: ["crm.example"],
      activeDurationMs: 1000,
      screenshots: [IMAGE, IMAGE]
    });
    expect(EpisodeAnalysisSchema.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({ ...ANALYSIS, provider: "openai_compatible" });
    const request = fake.requests[0];
    expect(request?.url).toBe("http://127.0.0.1:9000/v1/chat/completions");
    expect(request?.headers["authorization"]).toBe("Bearer secret");
    expect(systemText(request)).toContain("# Safety");
    expect(systemText(request)).toContain("untrusted data");
    expect(countImagesInBody(request?.body)).toBe(2);
    expect(JSON.stringify(request?.body)).toContain("data:image/png;base64,QUJD");
  });

  it("throws typed errors on non-JSON or schema-invalid replies instead of fabricating", async () => {
    const episode = { episodeId: "ep", redactedSummary: "", actionTokens: [], apps: [], domains: [], activeDurationMs: 0, screenshots: [] };
    const notJson = providerWith(["I cannot help with that."]);
    await expect(notJson.provider.analyzeEpisode(episode)).rejects.toBeInstanceOf(ProviderResponseError);
    const invalid = providerWith([JSON.stringify({ goal: "x" })]);
    const error = await invalid.provider.analyzeEpisode(episode).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderResponseError);
    expect((error as ProviderResponseError).issues.length).toBeGreaterThan(0);
    const unreachable = createFakeFetch(() => {
      throw new TypeError("ECONNREFUSED");
    });
    const down = new OpenAICompatibleVisionProvider({ baseUrl: BASE_URL, model: "llava", fetchImpl: unreachable.fetchImpl, ...noSleep });
    await expect(down.analyzeEpisode(episode)).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(unreachable.requests).toHaveLength(2);
  });

  it("drafts a skill with origin forced to model_refined", async () => {
    const draft: SkillDraft = {
      name: "n",
      description: "",
      goal: "",
      trigger: "t",
      subtasks: [{ title: "a", goal: "b", completionCriteria: "c", keySteps: [] }],
      variables: [],
      successCriteria: [],
      riskNotes: [],
      allowedApps: [],
      allowedDomains: [],
      origin: "deterministic",
      confidence: 0.4
    };
    const { provider } = providerWith([JSON.stringify({ ...draft, name: "Better name", origin: "deterministic" })]);
    const refined = await provider.draftSkill({ deterministicDraft: draft, redactedSummary: "", actionTokens: [], screenshots: [] });
    expect(refined.name).toBe("Better name");
    expect(refined.origin).toBe("model_refined");
  });

  it("verifies a step with method forced to model_supporting", async () => {
    const { provider, fake } = providerWith([JSON.stringify({ passed: true, subtaskComplete: false, evidence: "Dialog closed", confidence: 0.7, method: "accessibility" })]);
    const result = await provider.verifyStep({ runId: "r", expectedResult: "x", completionCriteria: "y", before: IMAGE, after: IMAGE });
    expect(result).toEqual({ passed: true, subtaskComplete: false, evidence: "Dialog closed", confidence: 0.7, method: "model_supporting" });
    expect(countImagesInBody(fake.requests[0]?.body)).toBe(2);
  });

  it("proposes a validated action and fills source screenshot and subtask index", async () => {
    const reply = { action: { type: "click", x: 10, y: 20, button: "left", purpose: "Open", expectedResult: "Opens", confidence: 0.8 }, actionSummary: "Open the record", rationale: "visible" };
    const { provider, fake } = providerWith([`<think>hidden</think>${JSON.stringify(reply)}`]);
    const result = await provider.proposeNextAction(nextInput());
    expect(result).toMatchObject({ actionSummary: "Open the record", rationale: "visible", provider: "openai_compatible", parseErrors: [] });
    expect(result.action).toMatchObject({ type: "click", x: 10, y: 20, subtaskIndex: 0, sourceScreenshot: { screenshotId: "shot_9", width: 1280, height: 800 } });
    expect(JSON.stringify(result)).not.toContain("hidden");
    expect(systemText(fake.requests[0])).toContain("# Safety");
    expect(systemText(fake.requests[0])).toContain('"type":"click"');
  });

  it("rejects unknown or invalid actions with parse errors and honours control tokens", async () => {
    const unknown = providerWith([JSON.stringify({ action: { type: "shell", command: "rm -rf" }, actionSummary: "x", rationale: "" })]);
    const first = await unknown.provider.proposeNextAction(nextInput());
    expect(first.action).toBeNull();
    expect(first.parseErrors[0]).toMatch(/unsupported action type/);

    const invalid = providerWith([JSON.stringify({ action: { type: "click", x: -5, y: 1 }, actionSummary: "x", rationale: "" })]);
    const second = await invalid.provider.proposeNextAction(nextInput());
    expect(second.action).toBeNull();
    expect(second.parseErrors.length).toBeGreaterThan(0);

    const complete = providerWith([JSON.stringify({ action: null, actionSummary: "done", rationale: "", controlToken: "SUBTASK_COMPLETE", subtaskCompleteEvidence: "listed" })]);
    const third = await complete.provider.proposeNextAction(nextInput());
    expect(third).toMatchObject({ action: null, controlToken: "SUBTASK_COMPLETE", subtaskCompleteEvidence: "listed" });

    const garbage = providerWith(["not json at all"]);
    await expect(garbage.provider.proposeNextAction(nextInput())).rejects.toBeInstanceOf(ProviderResponseError);
  });

  it("keeps at most imagesToKeep screenshots per run and resets sessions", async () => {
    const reply = JSON.stringify({ action: null, actionSummary: "s", rationale: "" });
    const { provider, fake } = providerWith([reply], { imagesToKeep: 2 });
    for (let i = 0; i < 4; i += 1) {
      await provider.proposeNextAction(nextInput({ screenshot: { pngBase64: `IMG${i}`, width: 1280, height: 800 } }));
    }
    expect(fake.requests.map((r) => countImagesInBody(r.body))).toEqual([1, 2, 2, 2]);
    await provider.resetSession("run_1");
    await provider.proposeNextAction(nextInput());
    expect(countImagesInBody(fake.requests[4]?.body)).toBe(1);
  });

  it("checks health through GET /models", async () => {
    const { provider, fake } = providerWith([]);
    const health = await provider.health();
    expect(health).toMatchObject({ ok: true, provider: "openai_compatible", model: "llava", capabilities: { vision: true, actionPolicy: false, structuredOutput: true } });
    expect(fake.requests[0]?.url).toBe("http://127.0.0.1:9000/v1/models");
    expect(fake.requests[0]?.method).toBe("GET");
    expect(() => new OpenAICompatibleVisionProvider({ baseUrl: "", model: "" })).toThrow(RangeError);
  });
});
