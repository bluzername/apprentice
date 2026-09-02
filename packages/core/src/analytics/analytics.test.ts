import { describe, expect, it } from "vitest";
import { ProductEventSchema } from "@apprentice/schemas";
import { makeProductEvent } from "./index.js";

describe("makeProductEvent", () => {
  it("builds validated events with numeric, boolean and token props", () => {
    const event = makeProductEvent("run_completed", { steps: 4, ok: true, provider: "mock" }, "abcdef0123456789", "sess1", { id: "pe1", ts: 5, riskClass: "read_only" });
    expect(ProductEventSchema.safeParse(event).success).toBe(true);
    expect(event).toMatchObject({ id: "pe1", ts: 5, name: "run_completed", props: { steps: 4, ok: true, provider: "mock" }, riskClass: "read_only", installationId: "abcdef0123456789", sessionId: "sess1" });
    const generated = makeProductEvent("app_launched", {}, "inst");
    expect(generated.id.startsWith("pe_")).toBe(true);
    expect(generated.sessionId).toBeUndefined();
  });

  it("rejects free text, forbidden keys and unknown names", () => {
    expect(() => makeProductEvent("run_completed", { note: "this is free text" }, "inst")).toThrow(/free text/);
    expect(() => makeProductEvent("run_completed", { title: "x" }, "inst")).toThrow(/forbidden/);
    expect(() => makeProductEvent("run_completed", { domain: 1 }, "inst")).toThrow(/forbidden/);
    expect(() => makeProductEvent("run_completed", { "bad-key": 1 }, "inst")).toThrow(/Invalid product event/);
    expect(() => makeProductEvent("run_completed", { token: "x".repeat(65) }, "inst")).toThrow();
    expect(() => makeProductEvent("not_a_real_event" as never, {}, "inst")).toThrow(/Invalid product event/);
  });
});
