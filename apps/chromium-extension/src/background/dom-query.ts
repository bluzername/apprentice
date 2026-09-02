/**
 * DOM state probing for run verification. The worker polls the app for a
 * pending query only while a run is active, forwards it to the active
 * allowlisted tab, and posts the answer back.
 */
import { DOM_QUERY_POLL_INTERVAL_MS } from "../shared/constants.js";
import { DomQueryReplySchema, type DomQueryReply } from "../shared/messages.js";
import { isDomainAllowlisted, stripUrl } from "../shared/url.js";
import { getDomQuery, postDomState, type ClientConfig } from "./client.js";
import type { ExtensionState, StateStore } from "./state.js";

export interface DomQueryDeps {
  readonly store: StateStore;
  readonly clientConfig: (state: ExtensionState) => ClientConfig | null;
  readonly activeTab: () => Promise<{ id: number; url: string } | null>;
  readonly askTab: (tabId: number, marker: string) => Promise<unknown>;
  readonly intervalMs?: number;
}

export interface DomQueryPoller {
  start(): void;
  stop(): void;
  tick(): Promise<boolean>;
  running(): boolean;
}

/** Runs one poll cycle. Returns true when a query was answered. */
export async function answerPendingQuery(deps: DomQueryDeps): Promise<boolean> {
  const state = await deps.store.read();
  const config = deps.clientConfig(state);
  if (config === null || !state.runActive) {
    return false;
  }
  const pending = await getDomQuery(config);
  if (pending.query === null) {
    return false;
  }
  const marker = pending.query.marker;
  const tab = await deps.activeTab();
  const stripped = tab ? stripUrl(tab.url) : null;
  if (tab === null || stripped === null || !isDomainAllowlisted(stripped.domain, state.allowlist)) {
    await postDomState(config, { marker, present: false });
    return true;
  }
  let reply: DomQueryReply = { present: false, domain: stripped.domain, path: stripped.path };
  try {
    const parsed = DomQueryReplySchema.safeParse(await deps.askTab(tab.id, marker));
    if (parsed.success) {
      reply = { ...parsed.data, domain: stripped.domain, path: stripped.path };
    }
  } catch {
    // No content script in that tab; answer "not present" with the location we know.
  }
  await postDomState(config, { marker, ...reply });
  return true;
}

export function createDomQueryPoller(deps: DomQueryDeps): DomQueryPoller {
  const intervalMs = deps.intervalMs ?? DOM_QUERY_POLL_INTERVAL_MS;
  let timer: ReturnType<typeof setInterval> | null = null;
  let busy = false;

  const tick = async (): Promise<boolean> => {
    if (busy) {
      return false;
    }
    busy = true;
    try {
      return await answerPendingQuery(deps);
    } catch {
      return false;
    } finally {
      busy = false;
    }
  };

  return {
    start() {
      if (timer === null) {
        timer = setInterval(() => void tick(), intervalMs);
      }
    },
    stop() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
    tick,
    running: () => timer !== null
  };
}
