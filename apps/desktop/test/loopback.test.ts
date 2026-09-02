import { describe, expect, it } from "vitest";
import type { ExtensionEvent } from "@apprentice/schemas";
import { systemClock } from "../src/main/services/clock.js";
import { createRecordingEmitter } from "../src/main/services/events.js";
import { silentLogger } from "../src/main/services/logger.js";
import { LoopbackServer } from "../src/main/services/loopback/server.js";
import { makeContext, nextPortRange } from "./helpers.js";

const EXT_ID = "abcdefghijklmnopabcdefghijklmnop";
const ORIGIN = `chrome-extension://${EXT_ID}`;

async function setup() {
  const context = makeContext();
  context.settings.update({ allowlist: { apps: [], domains: ["crm.example"] } });
  const ingested: ExtensionEvent[][] = [];
  const state = { runActive: false };
  const recorder = createRecordingEmitter();
  const server = new LoopbackServer({
    storage: context.storage,
    settings: context.settings,
    ingest: (events) => {
      ingested.push([...events]);
      return { accepted: events.length, dropped: 0 };
    },
    learningState: () => "learning",
    runActive: () => state.runActive,
    emit: recorder.emit,
    clock: systemClock,
    logger: silentLogger,
    portRange: nextPortRange()
  });
  const port = await server.start();
  const base = `http://127.0.0.1:${port}`;
  return { context, server, base, ingested, state, recorder };
}

async function pair(server: LoopbackServer, base: string): Promise<string> {
  const issued = server.issuePairingCode();
  const response = await fetch(`${base}/v1/pair`, { method: "POST", headers: { "content-type": "application/json", Origin: ORIGIN }, body: JSON.stringify({ code: issued.code, extensionId: EXT_ID, browser: "chrome", protocolVersion: "1.0" }) });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { token: string; productName: string };
  expect(body.productName).toBe("Apprentice");
  return body.token;
}

function authed(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, Origin: ORIGIN, "content-type": "application/json" };
}

describe("loopback server", () => {
  it("answers discovery without auth and reports pairing state", async () => {
    const { server, base } = await setup();
    const response = await fetch(`${base}/v1/discover`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ productName: "Apprentice", protocolVersion: "1.0", pairingRequired: true });
    await server.stop();
  });

  it("limits wrong pairing codes to five attempts, then accepts the right code", async () => {
    const { server, base } = await setup();
    const issued = server.issuePairingCode();
    const wrong = issued.code === "000000" ? "000001" : "000000";
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await fetch(`${base}/v1/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: wrong, extensionId: EXT_ID, browser: "chrome", protocolVersion: "1.0" }) });
      statuses.push(response.status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 403, 403]);
    const retry = await fetch(`${base}/v1/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: issued.code, extensionId: EXT_ID, browser: "chrome", protocolVersion: "1.0" }) });
    expect(retry.status).toBe(403);
    const token = await pair(server, base);
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(server.status().paired).toBe(true);
    expect(server.status().extensionId).toBe(EXT_ID);
    await server.stop();
  });

  it("accepts authenticated event batches and rejects bad tokens and origins", async () => {
    const { server, base, ingested, recorder } = await setup();
    const token = await pair(server, base);
    const batch = { protocolVersion: "1.0", events: [{ id: "e1", ts: Date.now(), type: "navigation", domain: "crm.example", path: "/contact/1" }] };
    const ok = await fetch(`${base}/v1/events`, { method: "POST", headers: authed(token), body: JSON.stringify(batch) });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ accepted: 1, dropped: 0 });
    expect(ingested).toHaveLength(1);
    expect(server.status().eventsReceived).toBe(1);
    expect(recorder.of("event:extension").length).toBeGreaterThan(0);
    const wrongOrigin = await fetch(`${base}/v1/events`, { method: "POST", headers: { ...authed(token), Origin: "chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz" }, body: JSON.stringify(batch) });
    expect(wrongOrigin.status).toBe(403);
    const noToken = await fetch(`${base}/v1/events`, { method: "POST", headers: { Origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify(batch) });
    expect(noToken.status).toBe(401);
    const badToken = await fetch(`${base}/v1/events`, { method: "POST", headers: authed("x".repeat(43)), body: JSON.stringify(batch) });
    expect(badToken.status).toBe(401);
    const tooLarge = await fetch(`${base}/v1/events`, { method: "POST", headers: authed(token), body: JSON.stringify({ protocolVersion: "1.0", events: [{ id: "big", ts: 1, type: "page_title", domain: "crm.example", title: "x".repeat(150) }], pad: "y".repeat(70_000) }) });
    expect(tooLarge.status).toBe(413);
    await server.stop();
  });

  it("serves the allowlist with runActive and round-trips DOM state queries", async () => {
    const { server, base, state } = await setup();
    const token = await pair(server, base);
    state.runActive = true;
    const allowlist = (await (await fetch(`${base}/v1/allowlist`, { headers: authed(token) })).json()) as Record<string, unknown>;
    expect(allowlist).toMatchObject({ domains: ["crm.example"], learningState: "learning", captureEnabled: true, productName: "Apprentice", runActive: true });
    const pending = server.queryDomState("event-created", 2000);
    const query = (await (await fetch(`${base}/v1/dom-query`, { headers: authed(token) })).json()) as { query: { marker: string } | null };
    expect(query).toEqual({ query: { marker: "event-created" } });
    const ack = await fetch(`${base}/v1/dom-state`, { method: "POST", headers: authed(token), body: JSON.stringify({ marker: "event-created", present: true, domain: "calendar.example", path: "/schedule" }) });
    expect(await ack.json()).toEqual({ ok: true });
    expect(await pending).toEqual({ marker: "event-created", present: true, domain: "calendar.example", path: "/schedule" });
    expect(await server.queryDomState("missing", 30)).toBeNull();
    const empty = (await (await fetch(`${base}/v1/dom-query`, { headers: authed(token) })).json()) as { query: unknown };
    expect(empty).toEqual({ query: null });
    server.unpair();
    expect(server.status().paired).toBe(false);
    expect(await server.queryDomState("x", 10)).toBeNull();
    await server.stop();
  });

  it("rate limits an authenticated client to 30 requests per 10 seconds", async () => {
    const { server, base } = await setup();
    const token = await pair(server, base);
    const statuses: number[] = [];
    for (let index = 0; index < 32; index += 1) statuses.push((await fetch(`${base}/v1/allowlist`, { headers: authed(token) })).status);
    expect(statuses.slice(0, 30).every((status) => status === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
    expect(statuses[31]).toBe(429);
    await server.stop();
  });
});
