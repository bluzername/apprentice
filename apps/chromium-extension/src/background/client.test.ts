import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EXTENSION_PROTOCOL_VERSION, PRODUCT_NAME, type ExtensionEvent } from "@apprentice/schemas";
import { startTestServer, type TestServer } from "../../test/loopback-test-server.js";
import { getAllowlist, getDomQuery, pair, postDomState, sendEvents, type ClientConfig } from "./client.js";
import { LoopbackError } from "./errors.js";
import { discover, probePort } from "./discovery.js";

const EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop";
const ORIGIN = `chrome-extension://${EXTENSION_ID}`;
const TOKEN = "test-token-0123456789abcdef0123456789abcdef";

const fetchImpl: ClientConfig["fetchImpl"] = (input, init) => fetch(input, init);

function event(index: number): ExtensionEvent {
  return { id: `evt-${index}`, ts: 1000 + index, type: "navigation", domain: "example.com", path: "/" };
}

async function expectLoopbackError(promise: Promise<unknown>, kind: LoopbackError["kind"]): Promise<LoopbackError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(LoopbackError);
    expect((error as LoopbackError).kind).toBe(kind);
    return error as LoopbackError;
  }
  throw new Error(`Expected a ${kind} error`);
}

describe("loopback client against a real http server", () => {
  let server: TestServer;
  let config: ClientConfig;

  beforeAll(async () => {
    server = await startTestServer({ expectedOrigin: ORIGIN, pairingCode: "123456", token: TOKEN });
    config = { port: server.port, origin: ORIGIN, fetchImpl, token: TOKEN };
  });

  afterAll(async () => {
    await server.close();
  });

  it("discovers the app on its port", async () => {
    const info = await probePort(server.port, { fetchImpl });
    expect(info).toEqual({ productName: PRODUCT_NAME, protocolVersion: EXTENSION_PROTOCOL_VERSION, pairingRequired: true });
    const found = await discover({ fetchImpl, ports: [server.port] });
    expect(found?.port).toBe(server.port);
  });

  it("pairs with the correct code and rejects a wrong one", async () => {
    const unauthenticated = { port: server.port, origin: ORIGIN, fetchImpl };
    const response = await pair(unauthenticated, {
      code: "123456",
      extensionId: EXTENSION_ID,
      browser: "chrome",
      protocolVersion: EXTENSION_PROTOCOL_VERSION
    });
    expect(response.token).toBe(TOKEN);
    expect(response.productName).toBe(PRODUCT_NAME);
    await expectLoopbackError(
      pair(unauthenticated, { code: "000000", extensionId: EXTENSION_ID, browser: "chrome", protocolVersion: EXTENSION_PROTOCOL_VERSION }),
      "unauthorized"
    );
  });

  it("refuses to pair with an invalid request body before hitting the network", async () => {
    await expect(
      pair({ port: server.port, origin: ORIGIN, fetchImpl }, {
        code: "12",
        extensionId: EXTENSION_ID,
        browser: "chrome",
        protocolVersion: EXTENSION_PROTOCOL_VERSION
      })
    ).rejects.toThrow();
  });

  it("sends an event batch with the bearer token", async () => {
    const result = await sendEvents(config, [event(1), event(2)]);
    expect(result).toEqual({ accepted: 2, dropped: 0 });
    expect(server.received.events).toHaveLength(2);
  });

  it("fetches the allowlist including the optional runActive flag", async () => {
    server.setAllowlist({ domains: ["example.com", "docs.example.org"], runActive: true });
    const allowlist = await getAllowlist(config);
    expect(allowlist.domains).toEqual(["example.com", "docs.example.org"]);
    expect(allowlist.learningState).toBe("learning");
    expect(allowlist.captureEnabled).toBe(true);
    expect(allowlist.runActive).toBe(true);
  });

  it("round-trips a dom query and answer", async () => {
    server.setPendingQuery("Saved successfully");
    const pending = await getDomQuery(config);
    expect(pending.query?.marker).toBe("Saved successfully");
    await postDomState(config, { marker: "Saved successfully", present: true, domain: "example.com", path: "/x" });
    expect(server.received.domStates).toEqual([{ marker: "Saved successfully", present: true, domain: "example.com", path: "/x" }]);
    expect((await getDomQuery(config)).query).toBeNull();
  });

  it("throws unauthorized on a bad token and without a token", async () => {
    const error = await expectLoopbackError(getAllowlist({ ...config, token: "wrong-token" }), "unauthorized");
    expect(error.status).toBe(401);
    await expectLoopbackError(getAllowlist({ ...config, token: undefined }), "unauthorized");
  });

  it("throws forbidden on an origin mismatch", async () => {
    const error = await expectLoopbackError(getAllowlist({ ...config, origin: "chrome-extension://someoneelse" }), "forbidden");
    expect(error.status).toBe(403);
  });

  it("throws rate_limited with Retry-After on 429", async () => {
    server.setRateLimited(true);
    try {
      const error = await expectLoopbackError(sendEvents(config, [event(3)]), "rate_limited");
      expect(error.status).toBe(429);
      expect(error.retryAfterMs).toBe(2000);
    } finally {
      server.setRateLimited(false);
    }
  });

  it("throws network errors when nothing listens", async () => {
    await expectLoopbackError(getAllowlist({ ...config, port: 1 }), "network");
  });
});
