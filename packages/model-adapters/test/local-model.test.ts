/**
 * Opt-in smoke test against a real OpenAI-compatible endpoint.
 *
 *   RUN_LOCAL_MODEL_TEST=1 pnpm --filter @apprentice/model-adapters test:local-model
 *
 * Environment:
 *   APPRENTICE_MODEL_BASE_URL   default http://127.0.0.1:8000/v1
 *   APPRENTICE_MODEL_NAME       default UI_Mate
 *   APPRENTICE_MODEL_PROVIDER   default uimate (or openai_compatible)
 *
 * The screenshot is synthetic (grey background with a blue rectangle), so no
 * real screen content ever reaches the model, and the provider has no way to
 * execute anything: the assertion at the end checks the result carries no
 * `executed` field at all.
 */
import { describe, expect, it } from "vitest";
import { ActionTypeSchema, ControlTokenSchema, ProposedActionResultSchema, ProviderTypeSchema } from "@apprentice/schemas";
import { createProvider } from "../src/providers/factory.js";
import { makeSyntheticPngBase64 } from "../src/testing/png.js";

const ENABLED = process.env["RUN_LOCAL_MODEL_TEST"] === "1";
const BASE_URL = process.env["APPRENTICE_MODEL_BASE_URL"] ?? "http://127.0.0.1:8000/v1";
const MODEL = process.env["APPRENTICE_MODEL_NAME"] ?? "UI_Mate";
const PROVIDER = ProviderTypeSchema.catch("uimate").parse(process.env["APPRENTICE_MODEL_PROVIDER"] ?? "uimate");

describe("local model smoke test", () => {
  if (!ENABLED) {
    it.skip("skipped: set RUN_LOCAL_MODEL_TEST=1", () => undefined);
    return;
  }

  it(`proposes one action for a synthetic screenshot via ${PROVIDER} at ${BASE_URL}`, async () => {
    const provider = createProvider({ providerType: PROVIDER, baseUrl: BASE_URL, model: MODEL });

    const health = await provider.health();
    console.log("health:", JSON.stringify(health));
    expect(health.ok, health.message).toBe(true);

    const screenshot = {
      id: "synthetic_1",
      pngBase64: makeSyntheticPngBase64({
        width: 1280,
        height: 800,
        background: [210, 210, 210],
        rect: { x: 520, y: 340, w: 240, h: 120, color: [30, 90, 220] }
      }),
      width: 1280,
      height: 800
    };

    const result = await provider.proposeNextAction({
      runId: "smoke_run",
      sessionId: "smoke_session",
      instruction: "Click the blue rectangle",
      skill: {
        name: "Click the blue rectangle",
        subtasks: [
          {
            title: "Click the blue rectangle",
            goal: "Click the blue rectangle in the middle of the screen",
            completionCriteria: "The blue rectangle has been clicked",
            keySteps: ["Click the blue rectangle"]
          }
        ]
      },
      currentSubtaskIndex: 0,
      priorActions: [],
      screenshot,
      platform: "macos",
      variables: {}
    });
    console.log("result:", JSON.stringify({ ...result, action: result.action ? { type: result.action.type } : null }));

    expect(ProposedActionResultSchema.safeParse(result).success).toBe(true);
    expect(result.provider).toBe(PROVIDER);
    expect(result.latencyMs).toBeGreaterThan(0);
    const hasSupportedAction = result.action !== null && ActionTypeSchema.safeParse(result.action.type).success;
    const hasControlToken = result.controlToken !== undefined && ControlTokenSchema.safeParse(result.controlToken).success;
    expect(hasSupportedAction || hasControlToken).toBe(true);
    if (result.action && "x" in result.action) {
      expect(result.action.x).toBeLessThanOrEqual(result.action.sourceScreenshot.width);
      expect(result.action.y).toBeLessThanOrEqual(result.action.sourceScreenshot.height);
    }
    expect(JSON.stringify(result)).not.toContain("<think>");
    expect("executed" in result).toBe(false);
    await provider.resetSession("smoke_run");
  });
});
