import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestServer, type TestServer } from "../../test/loopback-test-server.js";
import type { ClientConfig } from "./client.js";
import { answerPendingQuery, createDomQueryPoller, type DomQueryDeps } from "./dom-query.js";
import { createStateStore, type ExtensionState, type StorageAreaLike } from "./state.js";

const ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
const TOKEN = "test-token-0123456789abcdef0123456789abcdef";

function memoryArea(): StorageAreaLike {
  const items: Record<string, unknown> = {};
  return {
    get: async (key) => (key in items ? { [key]: items[key] } : {}),
    set: async (values) => {
      Object.assign(items, values);
    },
    remove: async (key) => {
      delete items[key];
    }
  };
}

describe("dom query poller", () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer({ expectedOrigin: ORIGIN, token: TOKEN });
  });
  afterAll(async () => {
    await server.close();
  });

  async function deps(overrides: Partial<DomQueryDeps> & { runActive?: boolean; allowlist?: string[] }): Promise<DomQueryDeps> {
    const store = createStateStore(memoryArea());
    await store.update({ token: TOKEN, port: server.port, runActive: overrides.runActive ?? true, allowlist: overrides.allowlist ?? ["example.com"] });
    return {
      store,
      clientConfig: (state: ExtensionState): ClientConfig | null =>
        state.token === null || state.port === null ? null : { port: state.port, origin: ORIGIN, token: state.token, fetchImpl: (i, init) => fetch(i, init) },
      activeTab: async () => ({ id: 1, url: "https://app.example.com/orders?x=1" }),
      askTab: async () => ({ present: true }),
      ...overrides
    };
  }

  it("answers a pending query using the active allowlisted tab", async () => {
    server.received.domStates.length = 0;
    server.setPendingQuery("Order saved");
    expect(await answerPendingQuery(await deps({}))).toBe(true);
    expect(server.received.domStates).toEqual([{ marker: "Order saved", present: true, domain: "example.com", path: "/orders" }]);
  });

  it("reports not present when the active tab is outside the allowlist", async () => {
    server.received.domStates.length = 0;
    server.setPendingQuery("Order saved");
    const askTab = vi.fn(async () => ({ present: true }));
    await answerPendingQuery(await deps({ activeTab: async () => ({ id: 2, url: "https://bank.example.net/" }), askTab }));
    expect(askTab).not.toHaveBeenCalled();
    expect(server.received.domStates).toEqual([{ marker: "Order saved", present: false }]);
  });

  it("does nothing while no run is active or no query is pending", async () => {
    server.received.domStates.length = 0;
    server.setPendingQuery("x");
    expect(await answerPendingQuery(await deps({ runActive: false }))).toBe(false);
    server.setPendingQuery(null);
    expect(await answerPendingQuery(await deps({}))).toBe(false);
    expect(server.received.domStates).toEqual([]);
  });

  it("answers not present when the content script does not respond", async () => {
    server.received.domStates.length = 0;
    server.setPendingQuery("Missing");
    await answerPendingQuery(
      await deps({
        askTab: async () => {
          throw new Error("Could not establish connection");
        }
      })
    );
    expect(server.received.domStates).toEqual([{ marker: "Missing", present: false, domain: "example.com", path: "/orders" }]);
  });

  describe("interval", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("starts and stops an interval without double-scheduling", async () => {
      vi.useRealTimers();
      const resolved = await deps({});
      vi.useFakeTimers();
      const poller = createDomQueryPoller({ ...resolved, intervalMs: 50 });
      expect(poller.running()).toBe(false);
      poller.start();
      poller.start();
      expect(poller.running()).toBe(true);
      expect(vi.getTimerCount()).toBe(1);
      poller.stop();
      expect(poller.running()).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
