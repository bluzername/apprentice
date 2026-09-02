/**
 * Background service worker entry. Wires discovery, pairing, the event queue,
 * allowlist sync, download observation, DOM queries, and the message bus.
 * The worker only ever talks to 127.0.0.1.
 */
import { EXTENSION_PROTOCOL_VERSION, PRODUCT_NAME, type ExtensionEvent } from "@apprentice/schemas";
import { detectBrowserFromNavigator } from "../shared/browser.js";
import { ALLOWLIST_SYNC_ALARM, ALLOWLIST_SYNC_PERIOD_MINUTES } from "../shared/constants.js";
import type { HelloResponse, PopupStatus } from "../shared/messages.js";
import { isDomainAllowlisted, stripUrl } from "../shared/url.js";
import { createTabBroadcaster, grantedDomains, runAllowlistSync, type SyncDeps } from "./allowlist-sync.js";
import { pair, postDomState, sendEvents, type ClientConfig, type FetchImpl } from "./client.js";
import { discover } from "./discovery.js";
import { createDomQueryPoller } from "./dom-query.js";
import { downloadEventFor } from "./downloads.js";
import { createRuntimeListener, type MessageHandlers, type SenderInfo } from "./messages.js";
import { createEventQueue } from "./queue.js";
import { captureAllowed } from "./registration.js";
import { INITIAL_STATE, chromeStorageArea, createStateStore, type ExtensionState } from "./state.js";

const extensionId = chrome.runtime.id;
const origin = `chrome-extension://${extensionId}`;
const fetchImpl: FetchImpl = (input, init) => fetch(input, init);
const store = createStateStore(chromeStorageArea());

let snapshot: ExtensionState = INITIAL_STATE;

async function refreshSnapshot(): Promise<ExtensionState> {
  snapshot = await store.read();
  return snapshot;
}

function clientConfigFor(state: ExtensionState): ClientConfig | null {
  if (state.token === null || state.port === null) {
    return null;
  }
  return { port: state.port, origin, fetchImpl, token: state.token };
}

function gate(state: ExtensionState): boolean {
  return captureAllowed({
    paired: state.token !== null,
    captureEnabled: state.captureEnabled,
    learningState: state.learningState,
    localPaused: state.localPaused
  });
}

async function unpair(): Promise<void> {
  await store.clearPairing();
  await refreshSnapshot();
  const registered = await chrome.scripting.getRegisteredContentScripts();
  const ids = registered.map((script) => script.id);
  if (ids.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids });
  }
  domPoller.stop();
}

const queue = createEventQueue({
  send: async (events) => {
    const config = clientConfigFor(snapshot);
    if (config === null) {
      throw new Error("Not paired");
    }
    return sendEvents(config, events);
  },
  isPaired: () => snapshot.token !== null && snapshot.port !== null,
  onUnauthorized: unpair,
  onFlushed: (result) => {
    void store
      .update((state) => ({ stats: { ...state.stats, eventsSent: state.stats.eventsSent + result.accepted } }))
      .then(refreshSnapshot);
  },
  onFailure: (error) => {
    const message = error instanceof Error ? error.message : String(error);
    void store
      .update((state) => ({
        stats: { ...state.stats, batchesFailed: state.stats.batchesFailed + 1, lastError: message.slice(0, 200) }
      }))
      .then(refreshSnapshot);
  },
  onDropped: (count) => {
    void store
      .update((state) => ({ stats: { ...state.stats, eventsDropped: state.stats.eventsDropped + count } }))
      .then(refreshSnapshot);
  }
});

const syncDeps: SyncDeps = {
  store,
  clientConfig: clientConfigFor,
  hasOriginPermission: (patterns) => chrome.permissions.contains({ origins: [...patterns] }),
  getRegisteredIds: async () => (await chrome.scripting.getRegisteredContentScripts()).map((script) => script.id),
  register: (scripts) => chrome.scripting.registerContentScripts([...scripts]),
  unregister: (ids) => chrome.scripting.unregisterContentScripts({ ids: [...ids] }),
  broadcast: createTabBroadcaster(),
  onUnauthorized: unpair
};

const domPoller = createDomQueryPoller({
  store,
  clientConfig: clientConfigFor,
  activeTab: async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tab && tab.id !== undefined && tab.url ? { id: tab.id, url: tab.url } : null;
  },
  askTab: (tabId, marker) => chrome.tabs.sendMessage(tabId, { type: "content:dom-query", marker })
});

async function syncNow(): Promise<ExtensionState> {
  const state = await runAllowlistSync(syncDeps);
  snapshot = state;
  if (state.runActive && state.token !== null) {
    domPoller.start();
  } else {
    domPoller.stop();
  }
  return state;
}

function tabDomain(sender: SenderInfo): { domain: string; path: string } | null {
  const stripped = sender.tabUrl ? stripUrl(sender.tabUrl) : null;
  return stripped === null ? null : { domain: stripped.domain, path: stripped.path };
}

function acceptEvent(event: ExtensionEvent, sender: SenderInfo): boolean {
  const location = tabDomain(sender);
  if (location === null || location.domain !== event.domain) {
    return false;
  }
  return gate(snapshot) && isDomainAllowlisted(event.domain, snapshot.allowlist);
}

async function pairWithCode(code: string): Promise<void> {
  const found = await discover({ fetchImpl }, snapshot.port ?? undefined);
  if (found === null) {
    throw new Error(`${PRODUCT_NAME} was not found on 127.0.0.1. Open the desktop app and try again.`);
  }
  const browser = detectBrowserFromNavigator(globalThis.navigator);
  const response = await pair(
    { port: found.port, origin, fetchImpl },
    { code, extensionId, browser, protocolVersion: EXTENSION_PROTOCOL_VERSION }
  );
  await store.update({
    token: response.token,
    port: found.port,
    extensionId,
    browser,
    productName: response.productName,
    stats: { ...snapshot.stats, lastError: null }
  });
  await refreshSnapshot();
  await syncNow();
}

async function popupStatus(): Promise<PopupStatus> {
  const state = await refreshSnapshot();
  const granted = await grantedDomains(state.allowlist, syncDeps.hasOriginPermission);
  return {
    ok: true,
    paired: state.token !== null,
    port: state.port,
    browser: state.browser,
    extensionId,
    learningState: state.learningState,
    captureEnabled: state.captureEnabled,
    localPaused: state.localPaused,
    allowlist: [...state.allowlist],
    grantedDomains: [...granted],
    lastSync: state.lastSync,
    productName: state.productName ?? PRODUCT_NAME,
    stats: { ...state.stats }
  };
}

const handlers: MessageHandlers = {
  "content:hello": async (message, sender): Promise<HelloResponse> => {
    const location = tabDomain(sender);
    const capture =
      location !== null &&
      location.domain === message.domain &&
      gate(snapshot) &&
      isDomainAllowlisted(location.domain, snapshot.allowlist);
    return { ok: true, capture };
  },
  "content:event": async (message, sender) => {
    if (!acceptEvent(message.event, sender)) {
      return { ok: false, error: "Event rejected by capture gate" };
    }
    queue.enqueue(message.event);
    return { ok: true };
  },
  "content:dom-state": async (message, sender) => {
    const config = clientConfigFor(snapshot);
    const location = tabDomain(sender);
    if (config === null || location === null) {
      return { ok: false, error: "Not paired" };
    }
    await postDomState(config, { marker: message.marker, present: message.present, ...location });
    return { ok: true };
  },
  "popup:status": async () => popupStatus(),
  "popup:pair": async (message) => {
    await pairWithCode(message.code);
    return popupStatus();
  },
  "popup:unpair": async () => {
    await unpair();
    return popupStatus();
  },
  "popup:set-local-pause": async (message) => {
    await store.update({ localPaused: message.paused });
    await refreshSnapshot();
    await syncNow();
    return popupStatus();
  },
  "popup:sync": async () => {
    await syncNow();
    return popupStatus();
  }
};

chrome.runtime.onMessage.addListener(createRuntimeListener(handlers, () => extensionId));

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALLOWLIST_SYNC_ALARM) {
    void syncNow().catch((error: unknown) => console.warn("[apprentice] sync failed", error));
  }
});

chrome.downloads.onCreated.addListener((item) => {
  if (!gate(snapshot)) {
    return;
  }
  const event = downloadEventFor(
    { filename: item.filename, url: item.url, referrer: item.referrer },
    snapshot.allowlist
  );
  if (event !== null) {
    queue.enqueue(event);
  }
});

chrome.permissions.onAdded.addListener(() => void syncNow().catch(() => undefined));
chrome.permissions.onRemoved.addListener(() => void syncNow().catch(() => undefined));

chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "local") {
    void refreshSnapshot();
  }
});

async function ensureAlarm(): Promise<void> {
  const existing = await chrome.alarms.get(ALLOWLIST_SYNC_ALARM);
  if (!existing) {
    await chrome.alarms.create(ALLOWLIST_SYNC_ALARM, { periodInMinutes: ALLOWLIST_SYNC_PERIOD_MINUTES });
  }
}

async function boot(): Promise<void> {
  await refreshSnapshot();
  await ensureAlarm();
  if (snapshot.token !== null) {
    await syncNow().catch((error: unknown) => console.warn("[apprentice] initial sync failed", error));
  }
}

chrome.runtime.onInstalled.addListener(() => void boot());
chrome.runtime.onStartup.addListener(() => void boot());
void boot();

