import { describe, expect, it, vi } from "vitest";
import { EXTENSION_PROTOCOL_VERSION, LOOPBACK_PORT_RANGE, PRODUCT_NAME } from "@apprentice/schemas";
import type { FetchImpl } from "./client.js";
import { discover, portRange, probePort } from "./discovery.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const good = { productName: PRODUCT_NAME, protocolVersion: EXTENSION_PROTOCOL_VERSION, pairingRequired: true };

function stubFetch(answers: Record<number, () => Response | Promise<Response>>): FetchImpl & { calls: string[] } {
  const calls: string[] = [];
  const impl = (async (input: string) => {
    calls.push(input);
    const port = Number(new URL(input).port);
    const answer = answers[port];
    if (answer === undefined) {
      throw new TypeError("connect ECONNREFUSED");
    }
    return answer();
  }) as FetchImpl & { calls: string[] };
  impl.calls = calls;
  return impl;
}

describe("discovery", () => {
  it("enumerates the full loopback port range", () => {
    const ports = portRange();
    expect(ports[0]).toBe(LOOPBACK_PORT_RANGE.start);
    expect(ports[ports.length - 1]).toBe(LOOPBACK_PORT_RANGE.end);
    expect(ports).toHaveLength(11);
  });

  it("picks the first responding port in order", async () => {
    const fetchImpl = stubFetch({ 47818: () => jsonResponse(good), 47820: () => jsonResponse(good) });
    const found = await discover({ fetchImpl });
    expect(found?.port).toBe(47818);
    expect(fetchImpl.calls).toHaveLength(4);
    expect(fetchImpl.calls.every((url) => url.startsWith("http://127.0.0.1:"))).toBe(true);
  });

  it("tries the cached port first", async () => {
    const fetchImpl = stubFetch({ 47815: () => jsonResponse(good), 47822: () => jsonResponse(good) });
    const found = await discover({ fetchImpl }, 47822);
    expect(found?.port).toBe(47822);
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it("ignores ports that answer with the wrong product, protocol, or shape", async () => {
    const fetchImpl = stubFetch({
      47815: () => jsonResponse({ ...good, productName: "Other" }),
      47816: () => jsonResponse({ ...good, protocolVersion: "9.9" }),
      47817: () => jsonResponse({ hello: "world" }),
      47818: () => jsonResponse(good, 500),
      47819: () => new Response("<html>", { status: 200 })
    });
    expect(await discover({ fetchImpl })).toBeNull();
    expect(await probePort(47815, { fetchImpl })).toBeNull();
  });

  it("never throws on a rejecting fetch", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("boom");
    });
    expect(await probePort(47815, { fetchImpl })).toBeNull();
  });
});
