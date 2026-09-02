/**
 * Persistent extension state stored in chrome.storage.local. Every update
 * produces a new state object; nothing is mutated in place.
 */
import type { BrowserKind } from "../shared/browser.js";
import type { LearningState } from "../shared/messages.js";

export interface ExtensionStats {
  readonly eventsSent: number;
  readonly eventsDropped: number;
  readonly batchesFailed: number;
  readonly lastError: string | null;
}

export interface ExtensionState {
  readonly token: string | null;
  readonly port: number | null;
  readonly extensionId: string | null;
  readonly browser: BrowserKind;
  readonly allowlist: readonly string[];
  readonly learningState: LearningState | null;
  readonly captureEnabled: boolean;
  readonly runActive: boolean;
  readonly localPaused: boolean;
  readonly lastSync: number | null;
  readonly productName: string | null;
  readonly stats: ExtensionStats;
}

export const INITIAL_STATS: ExtensionStats = Object.freeze({
  eventsSent: 0,
  eventsDropped: 0,
  batchesFailed: 0,
  lastError: null
});

export const INITIAL_STATE: ExtensionState = Object.freeze({
  token: null,
  port: null,
  extensionId: null,
  browser: "unknown" as BrowserKind,
  allowlist: [],
  learningState: null,
  captureEnabled: false,
  runActive: false,
  localPaused: false,
  lastSync: null,
  productName: null,
  stats: INITIAL_STATS
});

export const STATE_KEY = "apprenticeState";

/** Minimal surface of chrome.storage.local so the store can be tested with an in-memory area. */
export interface StorageAreaLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface StateStore {
  read(): Promise<ExtensionState>;
  update(patch: Partial<ExtensionState> | ((current: ExtensionState) => Partial<ExtensionState>)): Promise<ExtensionState>;
  clearPairing(): Promise<ExtensionState>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Merges stored data over the defaults so newly added fields always have a value. */
export function hydrateState(raw: unknown): ExtensionState {
  if (!isRecord(raw)) {
    return INITIAL_STATE;
  }
  const stats = isRecord(raw.stats) ? { ...INITIAL_STATS, ...(raw.stats as Partial<ExtensionStats>) } : INITIAL_STATS;
  const allowlist = Array.isArray(raw.allowlist) ? raw.allowlist.filter((d): d is string => typeof d === "string") : [];
  return { ...INITIAL_STATE, ...(raw as Partial<ExtensionState>), allowlist, stats };
}

export function applyPatch(current: ExtensionState, patch: Partial<ExtensionState>): ExtensionState {
  return { ...current, ...patch, stats: { ...current.stats, ...(patch.stats ?? {}) } };
}

export function withPairingCleared(current: ExtensionState): ExtensionState {
  return {
    ...current,
    token: null,
    port: null,
    allowlist: [],
    learningState: null,
    captureEnabled: false,
    runActive: false,
    lastSync: null
  };
}

export function createStateStore(area: StorageAreaLike): StateStore {
  let chain: Promise<unknown> = Promise.resolve();

  const serialized = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work);
    chain = next.catch(() => undefined);
    return next;
  };

  const read = async (): Promise<ExtensionState> => {
    const items = await area.get(STATE_KEY);
    return hydrateState(items[STATE_KEY]);
  };

  return {
    read,
    update: (patch) =>
      serialized(async () => {
        const current = await read();
        const resolved = typeof patch === "function" ? patch(current) : patch;
        const next = applyPatch(current, resolved);
        await area.set({ [STATE_KEY]: next });
        return next;
      }),
    clearPairing: () =>
      serialized(async () => {
        const next = withPairingCleared(await read());
        await area.set({ [STATE_KEY]: next });
        return next;
      })
  };
}

export function chromeStorageArea(): StorageAreaLike {
  return {
    get: (key) => chrome.storage.local.get(key),
    set: (items) => chrome.storage.local.set(items),
    remove: (key) => chrome.storage.local.remove(key)
  };
}
