import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { countRows, feedbackPayload, installationId, json, post, resetDb, telemetryPayload } from "./helpers.js";

interface IngestResponse {
  ok: boolean;
  duplicate?: boolean;
  id?: string;
  error?: string;
  issues?: { path: string; code: string }[];
}

const issuePaths = (body: IngestResponse): string[] => (body.issues ?? []).map((i) => i.path);

describe("POST /v1/feedback", () => {
  beforeEach(resetDb);

  it("stores a valid payload with its events and feedback items", async () => {
    const payload = feedbackPayload({ installationId: installationId("store-ok") });
    const res = await post("/v1/feedback", payload);
    expect(res.status).toBe(200);
    const body = await json<IngestResponse>(res);
    expect(body).toMatchObject({ ok: true, duplicate: false });
    expect(typeof body.id).toBe("string");

    const submission = await env.DB.prepare("SELECT * FROM submissions WHERE id = ?1").bind(body.id).first();
    expect(submission).toMatchObject({
      kind: "feedback",
      installation_id: installationId("store-ok"),
      participant_code: "alpha-01",
      app_version: "0.1.0-alpha.1",
      macos_major: 15,
      chip_family: "m3",
      memory_bucket: "32",
      provider: "mock",
      model: "uimate-7b",
      model_version: "2026.08"
    });
    expect(submission?.payload_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(Number(submission?.payload_bytes)).toBe(new TextEncoder().encode(JSON.stringify(payload)).byteLength);

    expect(await countRows("events", "submission_id = ?1", body.id)).toBe(2);
    const event = await env.DB.prepare("SELECT * FROM events WHERE submission_id = ?1 AND name = 'candidate_generated'").bind(body.id).first();
    expect(event).toMatchObject({ risk_class: "read_only", provider: "mock", counts_json: '{"steps":4}' });

    const item = await env.DB.prepare("SELECT * FROM feedback_items WHERE submission_id = ?1").bind(body.id).first();
    expect(item).toMatchObject({ context_type: "candidate", comment: "Looks right", created_at: 1_756_000_200_000 });
    expect(JSON.parse(String(item?.answers_json))).toMatchObject({ kind: "candidate", relevant: true });
  });

  it("rejects a forbidden key at the top level with 422 and issue paths only", async () => {
    const res = await post("/v1/feedback", feedbackPayload({ screenshot: "iVBORw0KGgo" }));
    expect(res.status).toBe(422);
    const body = await json<IngestResponse>(res);
    expect(body.error).toBe("invalid_payload");
    expect(issuePaths(body)).toContain("screenshot");
    expect(JSON.stringify(body)).not.toContain("iVBORw0KGgo");
    expect(await countRows("submissions")).toBe(0);
  });

  it("rejects a forbidden key nested deep inside an allowed object", async () => {
    const res = await post("/v1/feedback", feedbackPayload({ performance: { captureLatencyMs: 1, nested: { windowTitle: "Q3 budget.xlsx" } } }));
    expect(res.status).toBe(422);
    const paths = issuePaths(await json<IngestResponse>(res));
    expect(paths).toContain("performance.nested.windowTitle");
    expect(paths.join(" ")).not.toContain("budget");
  });

  it("rejects forbidden keys regardless of case, including inside arrays", async () => {
    const res = await post("/v1/feedback", feedbackPayload({ events: [{ name: "app_launched", ts: 1, counts: { OCRTEXT: 1 } }], ClipBoard: 1 }));
    expect(res.status).toBe(422);
    const paths = issuePaths(await json<IngestResponse>(res));
    expect(paths).toContain("ClipBoard");
    expect(paths).toContain("events[0].counts.OCRTEXT");
  });

  it("allows the schema field events[].name even though name is a forbidden key elsewhere", async () => {
    const res = await post("/v1/feedback", feedbackPayload({ installationId: installationId("name-ok") }));
    expect(res.status).toBe(200);
    const bad = await post("/v1/feedback", feedbackPayload({ installationId: installationId("name-bad"), performance: { name: "x" } }));
    expect(bad.status).toBe(422);
  });

  it("rejects URL-like, email-like, base64 blob and data:image string values", async () => {
    const cases: { value: string; code: string }[] = [
      { value: "see https://intranet.example/report", code: "url_like" },
      { value: "saved on www.example.org yesterday", code: "url_like" },
      { value: "opened crm.example.com and clicked", code: "url_like" },
      { value: "ping me at person@example.com", code: "email_like" },
      { value: "A".repeat(201), code: "base64_blob" },
      { value: "data:image/png;base64,iVBOR", code: "image_data" }
    ];
    for (const { value, code } of cases) {
      const payload = feedbackPayload({
        feedback: [{ contextType: "general", answers: { kind: "general", sentiment: "neutral" }, comment: value, createdAt: 1 }]
      });
      const res = await post("/v1/feedback", payload);
      expect(res.status, value.slice(0, 40)).toBe(422);
      const body = await json<IngestResponse>(res);
      expect(body.issues).toContainEqual({ path: "feedback[0].comment", code });
      expect(JSON.stringify(body)).not.toContain(value.slice(0, 40));
    }
    expect(await countRows("submissions")).toBe(0);
  });

  it("accepts ordinary comments with punctuation, versions and short base64-looking tokens", async () => {
    const comment = "Worked well, e.g. v1.2.3 build; token abc123== was fine. 5/5!";
    const payload = feedbackPayload({
      installationId: installationId("plain"),
      feedback: [{ contextType: "general", answers: { kind: "general", sentiment: "positive" }, comment, createdAt: 1 }]
    });
    expect((await post("/v1/feedback", payload)).status).toBe(200);
  });

  it("rejects schema violations with zod issue paths and no values", async () => {
    const res = await post("/v1/feedback", feedbackPayload({ macosMajor: 9, chipFamily: "intel" }));
    expect(res.status).toBe(422);
    const body = await json<IngestResponse>(res);
    expect(issuePaths(body)).toEqual(expect.arrayContaining(["macosMajor", "chipFamily"]));
    expect(JSON.stringify(body)).not.toContain("intel");
  });

  it("rejects bodies over MAX_BODY_BYTES with 413", async () => {
    const res = await post("/v1/feedback", feedbackPayload(), { env: { MAX_BODY_BYTES: "64" } });
    expect(res.status).toBe(413);
    expect(await json(res)).toMatchObject({ ok: false, error: "payload_too_large" });
  });

  it("rejects oversized bodies even without content-length", async () => {
    const stream = new Blob([JSON.stringify(feedbackPayload())]).stream();
    const request = new Request("https://feedback.test/v1/feedback", { method: "POST", body: stream, headers: { "content-type": "application/json" } });
    const worker = (await import("../src/index.js")).default;
    const res = await worker.fetch(request, { ...env, MAX_BODY_BYTES: "64" });
    expect(res.status).toBe(413);
  });

  it("rejects invalid JSON with 400", async () => {
    const res = await post("/v1/feedback", undefined, { rawBody: "{not json" });
    expect(res.status).toBe(400);
    expect(await json(res)).toMatchObject({ ok: false, error: "bad_request" });
  });

  it("rejects non-object JSON with 422", async () => {
    const res = await post("/v1/feedback", ["a", "b"]);
    expect(res.status).toBe(422);
    expect(await json<IngestResponse>(res)).toMatchObject({ issues: [{ path: "", code: "expected_object" }] });
  });

  it("detects duplicate submissions by payload hash", async () => {
    const payload = feedbackPayload({ installationId: installationId("dupe") });
    const first = await json<IngestResponse>(await post("/v1/feedback", payload));
    const second = await post("/v1/feedback", payload);
    expect(second.status).toBe(200);
    expect(await json<IngestResponse>(second)).toEqual({ ok: true, duplicate: true, id: first.id });
    expect(await countRows("submissions", "installation_id = ?1", installationId("dupe"))).toBe(1);
  });

  it("requires the INGEST_TOKEN bearer when configured", async () => {
    const payload = feedbackPayload({ installationId: installationId("token") });
    const missing = await post("/v1/feedback", payload, { env: { INGEST_TOKEN: "shared-secret" } });
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toBe("Bearer");
    const wrong = await post("/v1/feedback", payload, { env: { INGEST_TOKEN: "shared-secret" }, headers: { authorization: "Bearer nope" } });
    expect(wrong.status).toBe(401);
    const ok = await post("/v1/feedback", payload, { env: { INGEST_TOKEN: "shared-secret" }, headers: { authorization: "Bearer shared-secret" } });
    expect(ok.status).toBe(200);
  });
});

describe("POST /v1/telemetry-batch", () => {
  beforeEach(resetDb);

  it("stores a telemetry batch as a telemetry submission with events", async () => {
    const res = await post("/v1/telemetry-batch", telemetryPayload());
    expect(res.status).toBe(200);
    const body = await json<IngestResponse>(res);
    const submission = await env.DB.prepare("SELECT kind, installation_id, provider, macos_major FROM submissions WHERE id = ?1").bind(body.id).first();
    expect(submission).toEqual({ kind: "telemetry", installation_id: installationId("telemetry"), provider: null, macos_major: null });
    expect(await countRows("events", "submission_id = ?1", body.id)).toBe(1);
    expect(await countRows("feedback_items", "submission_id = ?1", body.id)).toBe(0);
  });

  it("applies the same forbidden-key and value policy", async () => {
    const forbidden = await post("/v1/telemetry-batch", telemetryPayload({ events: [{ name: "app_launched", ts: 1, counts: {}, url: 1 }] }));
    expect(forbidden.status).toBe(422);
    expect(issuePaths(await json<IngestResponse>(forbidden))).toContain("events[0].url");
    const urlValue = await post("/v1/telemetry-batch", telemetryPayload({ events: [{ name: "app_launched", ts: 1, counts: {}, provider: "https://x.example" }] }));
    expect(urlValue.status).toBe(422);
    const empty = await post("/v1/telemetry-batch", telemetryPayload({ events: [] }));
    expect(empty.status).toBe(422);
  });

  it("stores a full 500-event batch in one request", async () => {
    const events = Array.from({ length: 500 }, (_, i) => ({ name: "action_approved", ts: 1_756_000_000_000 + i, counts: { i } }));
    const res = await post("/v1/telemetry-batch", telemetryPayload({ installationId: installationId("big"), events }));
    expect(res.status).toBe(200);
    const body = await json<IngestResponse>(res);
    expect(await countRows("events", "submission_id = ?1", body.id)).toBe(500);
  });
});
