import { describe, expect, it } from "vitest";
import { CompositeVisionAgentProvider } from "./composite-provider.js";
import { createProvider } from "./factory.js";
import { backoffMs, chatCompletion, extractContentText, isRetryable, joinUrl, HttpStatusError } from "./http.js";
import { identityResizer, prepareModelImage, readPngDimensions, ImagePrepareError } from "./image.js";
import { extractFirstJsonObject, stripThinkBlocks } from "./json-extract.js";
import { MockVisionAgentProvider } from "./mock-provider.js";
import { OpenAICompatibleVisionProvider } from "./openai-compatible-provider.js";
import { UIMateProvider } from "./uimate-provider.js";
import { ProviderCapabilityError } from "./types.js";
import { chatReply, createFakeFetch, jsonResponse } from "../testing/fake-fetch.js";
import { makeSyntheticPng } from "../testing/png.js";

describe("CompositeVisionAgentProvider", () => {
  it("routes proposeNextAction to the action provider and the rest to analysis", async () => {
    const action = new UIMateProvider({ baseUrl: "http://127.0.0.1:1/v1", fetchImpl: () => Promise.reject(new TypeError("down")), sleep: () => Promise.resolve() });
    const analysis = new MockVisionAgentProvider();
    const composite = new CompositeVisionAgentProvider({ action, analysis });
    const episode = { episodeId: "e", redactedSummary: "", actionTokens: ["app:x|action:click"], apps: [], domains: [], activeDurationMs: 0, screenshots: [] };
    expect((await composite.analyzeEpisode(episode)).provider).toBe("mock");
    await expect(action.analyzeEpisode(episode)).rejects.toBeInstanceOf(ProviderCapabilityError);
    const health = await composite.health();
    expect(health.provider).toBe("uimate");
    expect(health.ok).toBe(false);
    expect(health.message).toContain("analysis:");
    await composite.resetSession("s");
  });
});

describe("createProvider", () => {
  it("builds each provider type and validates required fields", () => {
    expect(createProvider({ providerType: "mock" })).toBeInstanceOf(MockVisionAgentProvider);
    expect(createProvider({ providerType: "uimate", baseUrl: "http://127.0.0.1:8000/v1" })).toBeInstanceOf(UIMateProvider);
    expect(createProvider({ providerType: "openai_compatible", baseUrl: "http://127.0.0.1:8000/v1", model: "m" })).toBeInstanceOf(OpenAICompatibleVisionProvider);
    expect(() => createProvider({ providerType: "uimate" })).toThrow(RangeError);
    expect(() => createProvider({ providerType: "openai_compatible", baseUrl: "http://x" })).toThrow(RangeError);
  });
});

describe("http helpers", () => {
  it("joins URLs and classifies retryable failures like the reference client", () => {
    expect(joinUrl("http://h/v1/", "/models")).toBe("http://h/v1/models");
    expect(joinUrl("http://h/v1", "chat/completions")).toBe("http://h/v1/chat/completions");
    expect(isRetryable(new TypeError("fetch failed"))).toBe(true);
    expect(isRetryable(new HttpStatusError(500, "x"))).toBe(true);
    expect(isRetryable(new HttpStatusError(429, "x"))).toBe(true);
    // A 400 is a request-shaped failure (context overflow, bad payload): retrying it only burns the back-off.
    expect(isRetryable(new HttpStatusError(400, "x"))).toBe(false);
    expect(isRetryable(new HttpStatusError(401, "x"))).toBe(false);
    expect(isRetryable(new HttpStatusError(404, "x"))).toBe(false);
    expect(backoffMs(1)).toBe(5000);
    expect(backoffMs(9)).toBe(30000);
  });

  it("returns the assistant text together with the choice finish_reason", async () => {
    const http = {
      provider: "uimate" as const,
      baseUrl: "http://127.0.0.1:8000/v1",
      fetchImpl: createFakeFetch(() => jsonResponse({ choices: [{ message: { content: "hi" }, finish_reason: "length" }] })).fetchImpl,
      timeoutMs: 1000,
      maxAttempts: 1,
      sleep: () => Promise.resolve()
    };
    expect(await chatCompletion(http, { model: "m" })).toEqual({ content: "hi", finishReason: "length" });
  });

  it("reports an absent finish_reason as undefined", async () => {
    const http = {
      provider: "uimate" as const,
      baseUrl: "http://127.0.0.1:8000/v1",
      fetchImpl: createFakeFetch(() => chatReply("hi")).fetchImpl,
      timeoutMs: 1000,
      maxAttempts: 1,
      sleep: () => Promise.resolve()
    };
    expect(await chatCompletion(http, { model: "m" })).toEqual({ content: "hi", finishReason: undefined });
  });

  it("extracts content text from strings and part arrays", () => {
    expect(extractContentText(null)).toBe("");
    expect(extractContentText("abc")).toBe("abc");
    expect(extractContentText([{ type: "text", text: "a" }, { type: "image_url" }, { text: "b" }])).toBe("ab");
    expect(extractContentText(42)).toBe("42");
  });
});

describe("image preparation", () => {
  it("reads PNG dimensions and rejects non-PNG buffers", () => {
    expect(readPngDimensions(makeSyntheticPng({ width: 12, height: 7 }))).toEqual({ width: 12, height: 7 });
    expect(readPngDimensions(Buffer.from("not a png"))).toBeNull();
  });

  it("skips resizing when the dims are already aligned and keeps the identity result", async () => {
    const aligned = await prepareModelImage({ pngBase64: "QUJD", width: 1280, height: 800 }, identityResizer);
    expect(aligned).toMatchObject({ base64: "QUJD", width: 1280, height: 800, resized: false });
    const identity = await prepareModelImage({ pngBase64: "QUJD", width: 1920, height: 1080 }, identityResizer);
    expect(identity).toMatchObject({ base64: "QUJD", width: 1920, height: 1080, target: { width: 1920, height: 1088 }, resized: false });
  });

  it("uses the resizer output dims and fails loudly on non-PNG output", async () => {
    const out = makeSyntheticPng({ width: 1920, height: 1088 });
    const prepared = await prepareModelImage({ pngBase64: makeSyntheticPng({ width: 1920, height: 1080 }).toString("base64"), width: 1920, height: 1080 }, () => Promise.resolve(out));
    expect(prepared).toMatchObject({ width: 1920, height: 1088, resized: true });
    await expect(
      prepareModelImage({ pngBase64: "QUJD", width: 1920, height: 1080 }, () => Promise.resolve(Buffer.from("garbage")))
    ).rejects.toBeInstanceOf(ImagePrepareError);
  });
});

describe("json extraction", () => {
  it("finds the first balanced object, skipping prose, fences and think blocks", () => {
    expect(extractFirstJsonObject('<think>{"not": "this"}</think>Result: ```json\n{"a": "b}", "c": {"d": 1}}\n```')).toEqual({ ok: true, value: { a: "b}", c: { d: 1 } } });
    expect(extractFirstJsonObject("{oops} {\"ok\": true}")).toEqual({ ok: true, value: { ok: true } });
    expect(extractFirstJsonObject("no braces")).toMatchObject({ ok: false });
    expect(extractFirstJsonObject('{"unbalanced": 1')).toMatchObject({ ok: false });
    expect(stripThinkBlocks("a<think>b</think>c")).toBe("ac");
  });
});
