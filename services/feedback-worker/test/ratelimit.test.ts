import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { consumeBucket } from "../src/ratelimit.js";
import { feedbackPayload, installationId, json, post, resetDb } from "./helpers.js";

describe("rate limiting", () => {
  beforeEach(resetDb);

  it("returns 429 after 60 submissions for one installation within an hour", async () => {
    const inst = installationId("ratelimited");
    for (let i = 0; i < 60; i += 1) {
      const res = await post("/v1/feedback", feedbackPayload({ installationId: inst, events: [{ name: "app_launched", ts: i, counts: {} }] }));
      expect(res.status, `submission ${i + 1}`).toBe(200);
    }
    const blocked = await post("/v1/feedback", feedbackPayload({ installationId: inst, events: [{ name: "app_launched", ts: 999, counts: {} }] }));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await json(blocked)).toMatchObject({ ok: false, error: "rate_limited" });

    const other = await post("/v1/feedback", feedbackPayload({ installationId: installationId("other-inst") }));
    expect(other.status).toBe(200);
  });

  it("counts per IP independently of installation", async () => {
    const now = Date.parse("2026-09-02T10:00:00Z");
    for (let i = 1; i <= 600; i += 1) {
      const result = await consumeBucket(env.DB, "ip:198.51.100.7", 600, now + i);
      expect(result.allowed).toBe(true);
    }
    const blocked = await consumeBucket(env.DB, "ip:198.51.100.7", 600, now + 601);
    expect(blocked.allowed).toBe(false);
    expect(blocked.count).toBe(601);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(3600);
  });

  it("resets the counter when a new window starts", async () => {
    const start = Date.parse("2026-09-02T10:00:00Z");
    for (let i = 0; i < 3; i += 1) await consumeBucket(env.DB, "inst:window", 2, start + i);
    const blocked = await consumeBucket(env.DB, "inst:window", 2, start + 10);
    expect(blocked.allowed).toBe(false);
    const nextWindow = await consumeBucket(env.DB, "inst:window", 2, start + 60 * 60 * 1000);
    expect(nextWindow).toMatchObject({ allowed: true, count: 1 });
  });
});
