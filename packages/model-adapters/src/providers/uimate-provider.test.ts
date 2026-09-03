import { describe, expect, it } from "vitest";
import { ProposedActionResultSchema, type NextActionInput } from "@apprentice/schemas";
import { UIMateProvider, sanitizeForHistory } from "./uimate-provider.js";
import { MockVisionAgentProvider } from "./mock-provider.js";
import { ProviderCapabilityError, ProviderResponseError, ProviderUnavailableError } from "./types.js";
import { SAFETY_SECTION } from "./safety.js";
import { TURN_REMINDER_LINE } from "../uimate/workflow.js";
import { chatReply, countImagesInBody, createFakeFetch, hangUntilAbort, jsonResponse, modelsReply, routeByPath, type RecordedRequest } from "../testing/fake-fetch.js";
import { makeSyntheticPng } from "../testing/png.js";
import { readGoldenText } from "../testing/golden.js";

const BASE_URL = "http://127.0.0.1:8000/v1";

function toolCall(body: string): string {
  return `<tool_call>\n<function=computer_use>\n${body}</function>\n</tool_call>`;
}

function param(name: string, value: string): string {
  return `<parameter=${name}>\n${value}\n</parameter>\n`;
}

const THINK = "<think>\nsecret plan\n</think>\n\n";
const CLICK = `${THINK}<action>\nClick the blue button.\n</action>\n\n${toolCall(param("action", "left_click") + param("coordinate", "[500, 500]"))}`;
const SUBTASK_DONE = `${THINK}<action>\nSubtask done.\n</action>\n\n${toolCall(param("action", "subtask_complete") + param("current_subtask_idx", "0") + param("evidence", "The contact page is open."))}`;
const FINISHED = `${THINK}<action>\nAll done.\n</action>\n\n${toolCall(param("action", "finished") + param("status", "success"))}`;

function input(runId: string, subtask: number, overrides: Partial<NextActionInput> = {}): NextActionInput {
  return {
    runId,
    sessionId: "session_A",
    instruction: "Update the CRM after the meeting",
    skill: {
      name: "CRM update",
      subtasks: [
        { title: "Open contact", goal: "Open the contact record", completionCriteria: "The contact page is visible", keySteps: ["Click search", "Type the name"] },
        { title: "Log activity", goal: "Log the meeting", completionCriteria: "The activity is listed", keySteps: [] }
      ]
    },
    currentSubtaskIndex: subtask,
    priorActions: [],
    screenshot: { id: "shot_1", pngBase64: "QUJD", width: 1280, height: 800 },
    platform: "macos",
    variables: {},
    ...overrides
  };
}

const noSleep = { sleep: () => Promise.resolve() };

function providerWith(replies: readonly string[], options: Partial<ConstructorParameters<typeof UIMateProvider>[0]> = {}) {
  const fake = createFakeFetch(
    routeByPath({
      models: () => modelsReply(["UI_Mate"]),
      chat: (_request, callIndex) => chatReply(replies[Math.min(callIndex, replies.length - 1)] ?? "")
    })
  );
  const provider = new UIMateProvider({ baseUrl: BASE_URL, fetchImpl: fake.fetchImpl, ...noSleep, ...options });
  return { provider, fake };
}

function chatBodies(requests: readonly RecordedRequest[]): readonly Record<string, unknown>[] {
  return requests.filter((r) => r.url.endsWith("/chat/completions")).map((r) => r.body as Record<string, unknown>);
}

function systemText(body: Record<string, unknown>): string {
  const messages = body["messages"] as readonly { role: string; content: readonly { type: string; text?: string }[] }[];
  return messages[0]?.content[0]?.text ?? "";
}

describe("UIMateProvider.proposeNextAction", () => {
  it("sends the official max_tokens by default and a caller-supplied cap when given", async () => {
    const official = providerWith([CLICK]);
    await official.provider.proposeNextAction(input("run_tokens", 0));
    expect(chatBodies(official.fake.requests)[0]?.["max_tokens"]).toBe(16384);
    const capped = providerWith([CLICK], { maxTokens: 2048 });
    await capped.provider.proposeNextAction(input("run_tokens", 0));
    expect(chatBodies(capped.fake.requests)[0]?.["max_tokens"]).toBe(2048);
    expect(() => new UIMateProvider({ baseUrl: BASE_URL, maxTokens: 10 })).toThrow(RangeError);
  });

  it("sends the official request shape and returns a translated click", async () => {
    const { provider, fake } = providerWith([CLICK]);
    const result = await provider.proposeNextAction(input("run_1", 0));

    const body = chatBodies(fake.requests)[0];
    expect(body).toBeDefined();
    expect(body).toMatchObject({ model: "UI_Mate", max_tokens: 16384, temperature: 1.0, top_p: 0.95, chat_template_kwargs: { enable_thinking: true } });
    expect(fake.requests[0]?.url).toBe(`${BASE_URL}/chat/completions`);
    expect(fake.requests[0]?.headers["authorization"]).toBe("Bearer EMPTY");

    const system = systemText(body ?? {});
    const official = readGoldenText("system_prompt_workflow.txt");
    expect(system.startsWith(official)).toBe(true);
    expect(system).toBe(`${official}\n\n${SAFETY_SECTION}`);

    const messages = (body?.["messages"] ?? []) as readonly { role: string; content: readonly { type: string; text?: string; image_url?: { url: string } }[] }[];
    expect(messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(messages[1]?.content[0]).toEqual({ type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } });
    const userText = messages[1]?.content[1]?.text ?? "";
    expect(userText.startsWith("\n<workflow_progress>\n【➡️】subtask 0: Open the contact record\n")).toBe(true);
    expect(userText).toContain("Key Step 0: Click search");
    expect(userText.endsWith("\n\nInstruction: Update the CRM after the meeting")).toBe(true);

    expect(result).toMatchObject({ provider: "uimate", actionSummary: "Click the blue button.", parseErrors: [] });
    expect(result.action).toMatchObject({ type: "click", x: 640, y: 400, button: "left", subtaskIndex: 0, sourceScreenshot: { screenshotId: "shot_1", width: 1280, height: 800 } });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(ProposedActionResultSchema.safeParse(result).success).toBe(true);
    expect(JSON.stringify(result)).not.toContain("secret plan");
    expect(JSON.stringify(provider.sessionState("run_1"))).not.toContain("secret plan");
    expect(provider.sessionState("run_1")?.responses[0]?.startsWith("<action>")).toBe(true);
    expect(provider.sessionState("run_1")?.actions).toEqual(["Click the blue button."]);
  });

  it("replays compacted history and collapses images to imagesToKeep with step 0 pinned", async () => {
    const { provider, fake } = providerWith([CLICK], { imagesToKeep: 2 });
    for (let i = 0; i < 4; i += 1) {
      await provider.proposeNextAction(input("run_1", 0, { screenshot: { pngBase64: `IMG${i}`, width: 1280, height: 800 } }));
    }
    const bodies = chatBodies(fake.requests);
    expect(bodies).toHaveLength(4);
    const second = (bodies[1]?.["messages"] ?? []) as readonly { role: string; content: readonly { type: string; text?: string }[] }[];
    expect(second.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(second[2]?.content[0]?.text?.startsWith("<action>")).toBe(true);
    expect(second[2]?.content[0]?.text).not.toContain("<think>");
    expect(second[3]?.content[0]?.text).toBe("<tool_response>\n");

    const fourth = (bodies[3]?.["messages"] ?? []) as readonly { role: string; content: readonly { type: string; text?: string; image_url?: { url: string } }[] }[];
    expect(countImagesInBody(bodies[3])).toBe(2);
    expect(fourth[1]?.content[0]?.image_url?.url).toBe("data:image/png;base64,IMG0");
    expect(fourth[3]?.content[0]?.text).toBe("<tool_response>\nThis screenshot has been collapsed.\n</tool_response>");
    expect(fourth[fourth.length - 1]?.content[1]?.image_url?.url).toBe("data:image/png;base64,IMG3");
  });

  it("restates the current subtask on the latest turn of every follow-up request", async () => {
    const { provider, fake } = providerWith([CLICK]);
    await provider.proposeNextAction(input("run_1", 0));
    await provider.proposeNextAction(input("run_1", 0));
    const bodies = chatBodies(fake.requests);
    const textOf = (body: Record<string, unknown> | undefined): string => {
      const messages = (body?.["messages"] ?? []) as readonly { role: string; content: readonly { type: string; text?: string }[] }[];
      const last = messages[messages.length - 1];
      return (last?.content ?? []).map((block) => block.text ?? "").join("");
    };
    // The first request keeps the upstream first-turn prompt; nothing is appended.
    expect(textOf(bodies[0])).not.toContain("<current_subtask_reminder>");
    const second = textOf(bodies[1]);
    expect(second).toContain("<current_subtask_reminder>\nindex: 0 of ");
    expect(second).toContain("subtask_complete_flag: ");
    expect(second).toContain(TURN_REMINDER_LINE);
  });

  it("advances on subtask_complete, awaits finish on the last subtask, then reports DONE", async () => {
    const { provider } = providerWith([SUBTASK_DONE, SUBTASK_DONE, FINISHED]);
    const first = await provider.proposeNextAction(input("run_1", 0));
    expect(first).toMatchObject({ action: null, controlToken: "SUBTASK_COMPLETE", subtaskCompleteEvidence: "The contact page is open." });
    expect(provider.sessionState("run_1")?.pointer).toEqual({ index: 1, awaitFinish: false });

    const second = await provider.proposeNextAction(input("run_1", 1));
    expect(second.controlToken).toBe("SUBTASK_COMPLETE");
    expect(provider.sessionState("run_1")?.pointer).toEqual({ index: 1, awaitFinish: true });

    const third = await provider.proposeNextAction(input("run_1", 1));
    expect(third).toMatchObject({ controlToken: "DONE" });
    expect(third.action?.type).toBe("done");
  });

  it("treats a premature finished as subtask completion (official early-done rule)", async () => {
    const { provider } = providerWith([FINISHED]);
    const result = await provider.proposeNextAction(input("run_1", 0));
    expect(result.action).toBeNull();
    expect(result.controlToken).toBe("SUBTASK_COMPLETE");
    expect(result.subtaskCompleteEvidence).toMatch(/before the final subtask/);
  });

  it("returns DONE when the last subtask reports subtask_complete twice", async () => {
    const { provider } = providerWith([SUBTASK_DONE, SUBTASK_DONE]);
    await provider.proposeNextAction(input("run_1", 1));
    const result = await provider.proposeNextAction(input("run_1", 1));
    expect(result).toMatchObject({ action: null, controlToken: "DONE" });
  });

  it("retries once on a network error then succeeds, sleeping the official back-off", async () => {
    const delays: number[] = [];
    let calls = 0;
    const fake = createFakeFetch(() => {
      calls += 1;
      if (calls === 1) {
        throw new TypeError("fetch failed");
      }
      return chatReply(CLICK);
    });
    const provider = new UIMateProvider({ baseUrl: BASE_URL, fetchImpl: fake.fetchImpl, sleep: (ms) => { delays.push(ms); return Promise.resolve(); } });
    const result = await provider.proposeNextAction(input("run_1", 0));
    expect(result.action?.type).toBe("click");
    expect(calls).toBe(2);
    expect(delays).toEqual([5000]);
  });

  it("throws ProviderUnavailableError after two failed attempts", async () => {
    const fake = createFakeFetch(() => {
      throw new TypeError("ECONNREFUSED");
    });
    const provider = new UIMateProvider({ baseUrl: BASE_URL, fetchImpl: fake.fetchImpl, ...noSleep });
    await expect(provider.proposeNextAction(input("run_1", 0))).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(fake.requests).toHaveLength(2);
  });

  it("aborts on timeout via AbortController", async () => {
    const fake = createFakeFetch((request) => hangUntilAbort(request));
    const provider = new UIMateProvider({ baseUrl: BASE_URL, fetchImpl: fake.fetchImpl, timeoutMs: 20, ...noSleep });
    await expect(provider.proposeNextAction(input("run_1", 0))).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(fake.requests.every((r) => r.signal?.aborted)).toBe(true);
    expect(fake.requests).toHaveLength(2);
  });

  it("does not retry non-retryable HTTP statuses", async () => {
    const fake = createFakeFetch(() => jsonResponse({ error: "nope" }, 401));
    const provider = new UIMateProvider({ baseUrl: BASE_URL, fetchImpl: fake.fetchImpl, ...noSleep });
    const error = await provider.proposeNextAction(input("run_1", 0)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderUnavailableError);
    expect((error as ProviderUnavailableError).status).toBe(401);
    expect(fake.requests).toHaveLength(1);
  });

  it("throws ProviderResponseError on a malformed completion envelope", async () => {
    const fake = createFakeFetch(() => jsonResponse({ nope: true }));
    const provider = new UIMateProvider({ baseUrl: BASE_URL, fetchImpl: fake.fetchImpl, ...noSleep });
    await expect(provider.proposeNextAction(input("run_1", 0))).rejects.toBeInstanceOf(ProviderResponseError);
  });

  it("surfaces official parser rejections as parse errors instead of guessing", async () => {
    const bad = `<action>\nClick.\n</action>${toolCall(param("action", "left_click") + param("coordinate", '["a", "b"]'))}`;
    const { provider } = providerWith([bad]);
    const result = await provider.proposeNextAction(input("run_1", 0));
    expect(result.action).toBeNull();
    expect(result.parseErrors.some((e) => e.includes("official parser rejected"))).toBe(true);
  });

  it("uses the injected resizer and records the sent dimensions", async () => {
    const resized = makeSyntheticPng({ width: 1920, height: 1088 });
    let asked: readonly [number, number] | null = null;
    const { provider, fake } = providerWith([CLICK], {
      resizeImage: (_png, w, h) => {
        asked = [w, h];
        return Promise.resolve(resized);
      }
    });
    const original = makeSyntheticPng({ width: 1920, height: 1080 }).toString("base64");
    const result = await provider.proposeNextAction(input("run_1", 0, { screenshot: { pngBase64: original, width: 1920, height: 1080 } }));
    expect(asked).toEqual([1920, 1088]);
    expect(result.action?.sourceScreenshot).toEqual({ width: 1920, height: 1088 });
    expect(result.action).toMatchObject({ x: 960, y: 544 });
    const messages = (chatBodies(fake.requests)[0]?.["messages"] ?? []) as readonly { content: readonly { image_url?: { url: string } }[] }[];
    expect(messages[1]?.content[0]?.image_url?.url).toBe(`data:image/png;base64,${resized.toString("base64")}`);
  });

  it("keeps the original image with the identity resizer", async () => {
    const { provider } = providerWith([CLICK]);
    const result = await provider.proposeNextAction(input("run_1", 0, { screenshot: { pngBase64: "QUJD", width: 1920, height: 1080 } }));
    expect(result.action?.sourceScreenshot).toEqual({ width: 1920, height: 1080 });
    expect(result.action).toMatchObject({ x: 960, y: 540 });
  });

  it("resets session state by runId and by sessionId", async () => {
    const { provider } = providerWith([CLICK]);
    await provider.proposeNextAction(input("run_1", 0));
    await provider.proposeNextAction(input("run_2", 0));
    await provider.resetSession("run_1");
    expect(provider.sessionState("run_1")).toBeUndefined();
    expect(provider.sessionState("run_2")).toBeDefined();
    await provider.resetSession("session_A");
    expect(provider.sessionState("run_2")).toBeUndefined();
  });

  it("rejects an out-of-range subtask index and invalid options", async () => {
    const { provider } = providerWith([CLICK]);
    await expect(provider.proposeNextAction(input("run_1", 5))).rejects.toBeInstanceOf(RangeError);
    expect(() => new UIMateProvider({ baseUrl: BASE_URL, imagesToKeep: 0 })).toThrow(RangeError);
    expect(() => new UIMateProvider({ baseUrl: "" })).toThrow(RangeError);
  });
});

describe("UIMateProvider health and failover", () => {
  it("reports ok with UI-Mate capabilities when the alias is served", async () => {
    const { provider } = providerWith([]);
    const health = await provider.health();
    expect(health).toMatchObject({ ok: true, provider: "uimate", model: "UI_Mate", endpoint: BASE_URL, capabilities: { vision: true, actionPolicy: true, structuredOutput: false } });
    expect(health.message).toContain("available");
  });

  it("accepts any served model but reports the missing alias", async () => {
    const fake = createFakeFetch(routeByPath({ models: () => modelsReply(["other"]) }));
    const health = await new UIMateProvider({ baseUrl: BASE_URL, fetchImpl: fake.fetchImpl }).health();
    expect(health.ok).toBe(true);
    expect(health.message).toContain("not listed");
  });

  it("reports unreachable endpoints as not ok", async () => {
    const fake = createFakeFetch(() => {
      throw new TypeError("ECONNREFUSED");
    });
    const health = await new UIMateProvider({ baseUrl: BASE_URL, fetchImpl: fake.fetchImpl }).health();
    expect(health.ok).toBe(false);
    expect(health.message).toContain("ECONNREFUSED");
  });

  it("throws ProviderCapabilityError for analysis calls without a fallback", async () => {
    const { provider } = providerWith([]);
    const episode = { episodeId: "e", redactedSummary: "", actionTokens: [], apps: [], domains: [], activeDurationMs: 0, screenshots: [] };
    await expect(provider.analyzeEpisode(episode)).rejects.toBeInstanceOf(ProviderCapabilityError);
    await expect(provider.verifyStep({ runId: "r", expectedResult: "x", completionCriteria: "y", after: { pngBase64: "A", width: 1, height: 1 } })).rejects.toBeInstanceOf(ProviderCapabilityError);
  });

  it("delegates analysis calls to the configured fallback", async () => {
    const { provider } = providerWith([], { fallback: new MockVisionAgentProvider() });
    const analysis = await provider.analyzeEpisode({ episodeId: "e", redactedSummary: "", actionTokens: ["app:notion|action:click"], apps: [], domains: [], activeDurationMs: 0, screenshots: [] });
    expect(analysis.provider).toBe("mock");
  });

  it("sanitizes history text of any hidden reasoning", () => {
    expect(sanitizeForHistory("<think>a</think>\n<action>b</action>")).toBe("<action>b</action>");
    expect(sanitizeForHistory("thinking\u2026\n</think>\nno action here")).toBe("no action here");
    expect(sanitizeForHistory("<think>only</think>")).toBe("");
  });
});
