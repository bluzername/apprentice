import { describe, expect, it } from "vitest";
import { call, json } from "./helpers.js";

describe("health and routing", () => {
  it("GET /health reports service, version and time", async () => {
    const res = await call("/health");
    expect(res.status).toBe(200);
    const body = await json<{ ok: boolean; service: string; version: string; time: string }>(res);
    expect(body.ok).toBe(true);
    expect(body.service).toBe("apprentice-feedback");
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(Number.isNaN(Date.parse(body.time))).toBe(false);
  });

  it("sets JSON content type, no-store and security headers on every JSON response", async () => {
    for (const path of ["/health", "/nope"]) {
      const res = await call(path);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
      expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    }
  });

  it("returns 404 JSON for unknown routes", async () => {
    const res = await call("/v1/unknown");
    expect(res.status).toBe(404);
    expect(await json(res)).toMatchObject({ ok: false, error: "not_found" });
  });

  it("returns 405 with Allow for wrong methods on known routes", async () => {
    const res = await call("/v1/feedback", { method: "GET" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });

  it("answers OPTIONS without any CORS allow headers", async () => {
    const res = await call("/v1/feedback", { method: "OPTIONS", headers: { origin: "https://evil.example" } });
    expect(res.status).toBe(204);
    expect(res.headers.get("allow")).toContain("POST");
    for (const header of res.headers.keys()) expect(header.startsWith("access-control-")).toBe(false);
  });
});
