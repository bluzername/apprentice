import { describe, expect, it, vi } from "vitest";
import type { ClientConfig } from "./client.js";
import { LoopbackError } from "./errors.js";
import { fetchAndStoreAllowlist, grantedDomains, reconcileContentScripts, runAllowlistSync, type SyncDeps } from "./allowlist-sync.js";
import { scriptIdForDomain } from "./registration.js";
import { createStateStore, type ExtensionState, type StorageAreaLike } from "./state.js";

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

interface Harness {
  readonly deps: SyncDeps;
  readonly registered: Set<string>;
  readonly broadcasts: Array<{ type: string; domains: readonly string[] }>;
  readonly onUnauthorized: ReturnType<typeof vi.fn>;
}

async function harness(options: {
  allowlistBody?: unknown;
  status?: number;
  granted?: readonly string[];
  initiallyRegistered?: readonly string[];
  paired?: boolean;
}): Promise<Harness> {
  const store = createStateStore(memoryArea());
  const registered = new Set(options.initiallyRegistered ?? []);
  const broadcasts: Harness["broadcasts"] = [];
  const grantedSet = new Set((options.granted ?? []).flatMap((d) => [`https://*.${d}/*`, `http://*.${d}/*`]));
  const onUnauthorized = vi.fn(async () => {
    await store.clearPairing();
  });
  const fetchImpl: ClientConfig["fetchImpl"] = async () =>
    jsonResponse(
      options.allowlistBody ?? { domains: ["example.com"], learningState: "learning", captureEnabled: true, productName: "Apprentice" },
      options.status ?? 200
    );
  const deps: SyncDeps = {
    store,
    clientConfig: (state: ExtensionState) =>
      state.token === null || state.port === null ? null : { port: state.port, origin: "chrome-extension://x", fetchImpl, token: state.token },
    hasOriginPermission: async (patterns) => patterns.every((pattern) => grantedSet.has(pattern)),
    getRegisteredIds: async () => [...registered],
    register: async (scripts) => {
      for (const script of scripts) {
        registered.add(script.id);
      }
    },
    unregister: async (ids) => {
      for (const id of ids) {
        registered.delete(id);
      }
    },
    broadcast: async (message, domains) => {
      broadcasts.push({ type: message.type, domains });
    },
    onUnauthorized,
    now: () => 5000
  };
  if (options.paired !== false) {
    await store.update({ token: "tok", port: 47815 });
  }
  return { deps, registered, broadcasts, onUnauthorized };
}

describe("allowlist sync", () => {
  it("stores the fetched allowlist, learning state, and sync time", async () => {
    const h = await harness({ allowlistBody: { domains: ["Docs.Example.com", "other.org"], learningState: "paused", captureEnabled: false, productName: "Apprentice", runActive: true } });
    const state = await fetchAndStoreAllowlist(h.deps);
    expect(state.allowlist).toEqual(["example.com", "other.org"]);
    expect(state.learningState).toBe("paused");
    expect(state.captureEnabled).toBe(false);
    expect(state.runActive).toBe(true);
    expect(state.lastSync).toBe(5000);
  });

  it("does nothing when unpaired", async () => {
    const h = await harness({ paired: false });
    const state = await fetchAndStoreAllowlist(h.deps);
    expect(state.allowlist).toEqual([]);
    expect(state.lastSync).toBeNull();
  });

  it("clears pairing on 401 and records other failures", async () => {
    const unauthorized = await harness({ status: 401 });
    await fetchAndStoreAllowlist(unauthorized.deps);
    expect(unauthorized.onUnauthorized).toHaveBeenCalledTimes(1);
    expect((await unauthorized.deps.store.read()).token).toBeNull();

    const failing = await harness({ status: 500 });
    const state = await fetchAndStoreAllowlist(failing.deps);
    expect(state.stats.lastError).toContain("500");
    expect(state.token).toBe("tok");
  });

  it("registers content scripts only for granted domains and unregisters stale ones", async () => {
    const h = await harness({ granted: ["example.com"], initiallyRegistered: [scriptIdForDomain("stale.net")] });
    const state = await h.deps.store.update({ allowlist: ["example.com", "nogrant.org"] });
    const active = await reconcileContentScripts(h.deps, state);
    expect(active).toEqual(["example.com"]);
    expect([...h.registered]).toEqual([scriptIdForDomain("example.com")]);
    expect(h.broadcasts).toEqual([{ type: "content:stop", domains: ["stale.net"] }]);
  });

  it("unregisters everything when unpaired", async () => {
    const h = await harness({ paired: false, granted: ["example.com"], initiallyRegistered: [scriptIdForDomain("example.com")] });
    const state = await h.deps.store.update({ allowlist: ["example.com"] });
    await reconcileContentScripts(h.deps, state);
    expect(h.registered.size).toBe(0);
  });

  it("broadcasts start while learning and stop when capture is disabled or paused", async () => {
    const learning = await harness({ granted: ["example.com"] });
    await runAllowlistSync(learning.deps);
    expect(learning.broadcasts.at(-1)).toEqual({ type: "content:start", domains: ["example.com"] });

    const disabled = await harness({
      granted: ["example.com"],
      allowlistBody: { domains: ["example.com"], learningState: "learning", captureEnabled: false, productName: "Apprentice" }
    });
    await runAllowlistSync(disabled.deps);
    expect(disabled.broadcasts.at(-1)).toEqual({ type: "content:stop", domains: ["example.com"] });

    const privateMode = await harness({
      granted: ["example.com"],
      allowlistBody: { domains: ["example.com"], learningState: "private", captureEnabled: true, productName: "Apprentice" }
    });
    await runAllowlistSync(privateMode.deps);
    expect(privateMode.broadcasts.at(-1)?.type).toBe("content:stop");

    const locallyPaused = await harness({ granted: ["example.com"] });
    await locallyPaused.deps.store.update({ localPaused: true });
    await runAllowlistSync(locallyPaused.deps);
    expect(locallyPaused.broadcasts.at(-1)?.type).toBe("content:stop");
  });

  it("filters granted domains and skips malformed entries", async () => {
    const granted = await grantedDomains(["example.com", "bad domain", "other.org"], async (patterns) => patterns[0]?.includes("example.com") === true);
    expect(granted).toEqual(["example.com"]);
  });

  it("surfaces LoopbackError messages verbatim", () => {
    expect(new LoopbackError("http", "Unexpected status 500").message).toContain("500");
  });
});
