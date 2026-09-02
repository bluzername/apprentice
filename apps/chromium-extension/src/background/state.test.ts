import { describe, expect, it } from "vitest";
import { INITIAL_STATE, STATE_KEY, applyPatch, createStateStore, hydrateState, withPairingCleared, type StorageAreaLike } from "./state.js";

function memoryArea(): StorageAreaLike & { items: Record<string, unknown> } {
  const items: Record<string, unknown> = {};
  return {
    items,
    get: async (key) => (key in items ? { [key]: items[key] } : {}),
    set: async (values) => {
      Object.assign(items, values);
    },
    remove: async (key) => {
      delete items[key];
    }
  };
}

describe("state store", () => {
  it("returns defaults when nothing is stored and hydrates partial data", async () => {
    const store = createStateStore(memoryArea());
    expect(await store.read()).toEqual(INITIAL_STATE);
    expect(hydrateState({ token: "t", allowlist: ["a.com", 5], stats: { eventsSent: 3 } })).toMatchObject({
      token: "t",
      allowlist: ["a.com"],
      stats: { eventsSent: 3, eventsDropped: 0, batchesFailed: 0, lastError: null }
    });
  });

  it("applies patches immutably and persists them", async () => {
    const area = memoryArea();
    const store = createStateStore(area);
    const before = await store.read();
    const after = await store.update({ token: "abc", port: 47815 });
    expect(before.token).toBeNull();
    expect(after.token).toBe("abc");
    expect((area.items[STATE_KEY] as { port: number }).port).toBe(47815);
    const viaFunction = await store.update((current) => ({ stats: { ...current.stats, eventsSent: 9 } }));
    expect(viaFunction.stats.eventsSent).toBe(9);
    expect(viaFunction.token).toBe("abc");
  });

  it("serializes concurrent updates", async () => {
    const store = createStateStore(memoryArea());
    await Promise.all(
      Array.from({ length: 10 }, () => store.update((current) => ({ stats: { ...current.stats, eventsSent: current.stats.eventsSent + 1 } })))
    );
    expect((await store.read()).stats.eventsSent).toBe(10);
  });

  it("clears pairing but keeps local preferences and stats", async () => {
    const store = createStateStore(memoryArea());
    await store.update({ token: "abc", port: 47815, allowlist: ["a.com"], localPaused: true, learningState: "learning" });
    const cleared = await store.clearPairing();
    expect(cleared.token).toBeNull();
    expect(cleared.port).toBeNull();
    expect(cleared.allowlist).toEqual([]);
    expect(cleared.learningState).toBeNull();
    expect(cleared.localPaused).toBe(true);
    expect(withPairingCleared(applyPatch(INITIAL_STATE, { token: "x" })).token).toBeNull();
  });
});
