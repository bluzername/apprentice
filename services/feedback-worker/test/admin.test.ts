import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Summary } from "../src/summary.js";
import { ADMIN_TOKEN, call, feedbackPayload, installationId, json, post, resetDb } from "./helpers.js";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse("2026-08-01T09:00:00Z");

const candidate = (relevant: boolean, wouldDelegate: "yes" | "maybe" | "no", createdAt: number, comment?: string) => ({
  contextType: "candidate",
  answers: { kind: "candidate", relevant, wouldDelegate, boundaryAccuracy: "correct", reasonCodes: [] },
  ...(comment === undefined ? {} : { comment }),
  createdAt
});

const run = (outcomeAchieved: "yes" | "partly" | "no", trustRating: number, minutes: number, failureCategory: string, createdAt: number) => ({
  contextType: "run",
  answers: { kind: "run", outcomeAchieved, corrections: 0, estimatedTimeSavedMinutes: minutes, trustRating, wouldUseAgain: true, failureCategory },
  createdAt
});

const seedSubmission = async (inst: string, receivedAt: number, eventTimes: readonly number[]): Promise<void> => {
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB
      .prepare(
        `INSERT INTO submissions (id, kind, installation_id, app_version, received_at, payload_bytes, payload_hash)
         VALUES (?1, 'telemetry', ?2, '0.1.0', ?3, 10, ?4)`
      )
      .bind(id, inst, receivedAt, crypto.randomUUID()),
    ...eventTimes.map((ts) =>
      env.DB.prepare("INSERT INTO events (submission_id, name, ts, counts_json) VALUES (?1, 'app_launched', ?2, '{}')").bind(id, ts)
    )
  ]);
};

const seed = async (): Promise<void> => {
  const a = installationId("inst-a");
  const b = installationId("inst-b");
  const c = installationId("inst-c");
  const posts = [
    feedbackPayload({
      installationId: a,
      events: [
        { name: "candidate_generated", ts: T0, counts: {} },
        { name: "candidate_generated", ts: T0 + 1, counts: {} },
        { name: "candidate_accepted", ts: T0 + 2, counts: {} }
      ],
      feedback: [candidate(true, "yes", T0 + 10, "Great catch"), candidate(true, "maybe", T0 + 20), candidate(false, "no", T0 + 30, "Not a workflow")]
    }),
    feedbackPayload({
      installationId: b,
      participantCode: "alpha-02",
      events: [{ name: "run_completed", ts: T0 + 5, counts: {} }],
      feedback: [
        candidate(true, "yes", T0 + 40),
        run("yes", 5, 10, "none", T0 + 50),
        run("partly", 4, 30, "target_ambiguous", T0 + 60),
        run("no", 3, 0, "timeout", T0 + 70)
      ]
    })
  ];
  for (const payload of posts) expect((await post("/v1/feedback", payload)).status).toBe(200);

  // Retention: anchor is first activity. a is active on day 1 and 3, b on day 1 and 7, c only on day 0.
  await seedSubmission(a, T0 + DAY + 1000, [T0 + DAY + 500]);
  await seedSubmission(a, T0 + 3 * DAY, [T0 + 3 * DAY + 100]);
  await seedSubmission(b, T0 + DAY, [T0 + DAY + 100]);
  await seedSubmission(b, T0 + 7 * DAY, [T0 + 7 * DAY + 100, T0 + 7 * DAY + 200]);
  await seedSubmission(c, T0, [T0 + 60_000]);
};

describe("GET /v1/admin/summary", () => {
  beforeEach(resetDb);

  it("returns 401 without a token, with a wrong token, and when ADMIN_TOKEN is unset", async () => {
    expect((await call("/v1/admin/summary")).status).toBe(401);
    expect((await call("/v1/admin/summary", { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
    expect((await call("/v1/admin/summary", { headers: { authorization: `Bearer ${ADMIN_TOKEN}` }, env: { ADMIN_TOKEN: "" } })).status).toBe(401);
    expect((await call("/v1/admin/summary", { headers: { authorization: `Bearer ${ADMIN_TOKEN}extra` } })).status).toBe(401);
  });

  it("returns an empty but well-formed summary when nothing is stored", async () => {
    const res = await call("/v1/admin/summary", { headers: { authorization: `Bearer ${ADMIN_TOKEN}` } });
    expect(res.status).toBe(200);
    const summary = await json<Summary>(res);
    expect(summary.totals).toEqual({ submissions: 0, installations: 0, feedbackItems: 0, events: 0 });
    expect(summary.candidateRelevanceRate).toBeNull();
    expect(summary.meanTrustRating).toBeNull();
    expect(summary.medianTimeSavedMinutes).toBeNull();
    expect(summary.retention).toEqual({ cohort: 0, byDay: { "1": 0, "3": 0, "7": 0 } });
    expect(summary.comments).toEqual([]);
  });

  it("aggregates a seeded data set correctly", async () => {
    await seed();
    const res = await call("/v1/admin/summary", { headers: { authorization: `Bearer ${ADMIN_TOKEN}` } });
    expect(res.status).toBe(200);
    const summary = await json<Summary>(res);

    expect(summary.totals).toEqual({ submissions: 7, installations: 3, feedbackItems: 7, events: 4 + 6 });
    expect(summary.funnel).toEqual({ app_launched: 6, candidate_accepted: 1, candidate_generated: 2, run_completed: 1 });
    expect(summary.candidateFeedbackCount).toBe(4);
    expect(summary.candidateRelevanceRate).toBeCloseTo(0.75, 5);
    expect(summary.delegationIntent).toEqual({ yes: 2, maybe: 1, no: 1 });
    expect(summary.runOutcome).toEqual({ yes: 1, partly: 1, no: 1 });
    expect(summary.meanTrustRating).toBeCloseTo(4, 5);
    expect(summary.medianTimeSavedMinutes).toBe(10);
    expect(summary.failureCategories).toEqual({ none: 1, target_ambiguous: 1, timeout: 1 });
    expect(summary.retention).toEqual({ cohort: 3, byDay: { "1": 2, "3": 1, "7": 1 } });
    expect(summary.comments.map((c) => c.comment)).toEqual(["Not a workflow", "Great catch"]);
    expect(summary.comments[0]).toMatchObject({ contextType: "candidate", createdAt: T0 + 30 });
  });

  it("caps comments at the 50 most recent", async () => {
    const feedback = Array.from({ length: 60 }, (_, i) => candidate(true, "yes", T0 + i, `note ${i}`));
    expect((await post("/v1/feedback", feedbackPayload({ installationId: installationId("many"), feedback }))).status).toBe(200);
    const summary = await json<Summary>(await call("/v1/admin/summary", { headers: { authorization: `Bearer ${ADMIN_TOKEN}` } }));
    expect(summary.comments).toHaveLength(50);
    expect(summary.comments[0]?.comment).toBe("note 59");
    expect(summary.comments[49]?.comment).toBe("note 10");
  });
});

describe("GET /admin", () => {
  it("serves an HTML dashboard with inline assets only and never embeds a token or external URL", async () => {
    const res = await call("/admin");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(res.headers.get("content-security-policy")).toContain("script-src 'unsafe-inline'");
    expect(res.headers.get("content-security-policy")).toContain("style-src 'unsafe-inline'");
    const html = await res.text();
    expect(html).toContain("<!doctype html>");
    expect(html).not.toContain(ADMIN_TOKEN);
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+href=/i);
    expect(html).toContain("sessionStorage");
    expect(html).toContain('fetch("/v1/admin/summary"');
    expect(html).not.toMatch(/[?&]token=/);
  });
});
