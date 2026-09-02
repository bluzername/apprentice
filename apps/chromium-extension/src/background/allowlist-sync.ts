/**
 * Periodic allowlist synchronization. Registers a content script per
 * allowlisted domain only when the user has granted host permission for it,
 * and tells running content scripts to stop whenever capture is not allowed.
 */
import { LoopbackError, isLoopbackError } from "./errors.js";
import { getAllowlist, type ClientConfig } from "./client.js";
import { captureAllowed, contentScriptForDomain, diffRegistrations, domainFromScriptId } from "./registration.js";
import type { ExtensionState, StateStore } from "./state.js";
import { originPatternsForDomain, registrableDomain, stripUrl } from "../shared/url.js";
import type { BackgroundToContentMessage } from "../shared/messages.js";

export interface SyncDeps {
  readonly store: StateStore;
  readonly clientConfig: (state: ExtensionState) => ClientConfig | null;
  readonly hasOriginPermission: (patterns: readonly string[]) => Promise<boolean>;
  readonly getRegisteredIds: () => Promise<readonly string[]>;
  readonly register: (scripts: readonly chrome.scripting.RegisteredContentScript[]) => Promise<void>;
  readonly unregister: (ids: readonly string[]) => Promise<void>;
  readonly broadcast: (message: BackgroundToContentMessage, domains: readonly string[]) => Promise<void>;
  readonly onUnauthorized: () => Promise<void>;
  readonly now?: () => number;
}

export async function grantedDomains(
  allowlist: readonly string[],
  hasOriginPermission: SyncDeps["hasOriginPermission"]
): Promise<readonly string[]> {
  const results = await Promise.all(
    allowlist.map(async (domain) => {
      const patterns = originPatternsForDomain(domain);
      if (patterns.length === 0) {
        return null;
      }
      return (await hasOriginPermission(patterns)) ? registrableDomain(domain) : null;
    })
  );
  return results.filter((domain): domain is string => domain !== null);
}

/** Fetches the allowlist from the app and stores it. Returns the new state, or the previous one when unpaired. */
export async function fetchAndStoreAllowlist(deps: SyncDeps): Promise<ExtensionState> {
  const current = await deps.store.read();
  const config = deps.clientConfig(current);
  if (config === null) {
    return current;
  }
  try {
    const response = await getAllowlist(config);
    return await deps.store.update({
      allowlist: response.domains.map(registrableDomain).filter((d) => d.length > 0),
      learningState: response.learningState,
      captureEnabled: response.captureEnabled,
      runActive: response.runActive ?? false,
      productName: response.productName,
      lastSync: (deps.now ?? Date.now)(),
      stats: { ...current.stats, lastError: null }
    });
  } catch (error) {
    if (isLoopbackError(error) && error.kind === "unauthorized") {
      await deps.onUnauthorized();
      return deps.store.read();
    }
    const message = error instanceof LoopbackError ? error.message : String(error);
    return deps.store.update((state) => ({ stats: { ...state.stats, lastError: message.slice(0, 200) } }));
  }
}

/** Reconciles registered content scripts with the allowlist and granted permissions. */
export async function reconcileContentScripts(deps: SyncDeps, state: ExtensionState): Promise<readonly string[]> {
  const paired = state.token !== null;
  const desired = paired ? await grantedDomains(state.allowlist, deps.hasOriginPermission) : [];
  const registered = await deps.getRegisteredIds();
  const diff = diffRegistrations(desired, registered);
  if (diff.toUnregister.length > 0) {
    await deps.unregister(diff.toUnregister);
    const removedDomains = diff.toUnregister.map(domainFromScriptId).filter((d): d is string => d !== null);
    await deps.broadcast({ type: "content:stop" }, removedDomains);
  }
  if (diff.toRegister.length > 0) {
    const scripts = diff.toRegister
      .map(domainFromScriptId)
      .filter((d): d is string => d !== null)
      .map(contentScriptForDomain);
    await deps.register(scripts);
  }
  return desired;
}

/** Full sync pass used by the alarm and by the popup's "sync now" action. */
export async function runAllowlistSync(deps: SyncDeps): Promise<ExtensionState> {
  const state = await fetchAndStoreAllowlist(deps);
  const activeDomains = await reconcileContentScripts(deps, state);
  const allowed = captureAllowed({
    paired: state.token !== null,
    captureEnabled: state.captureEnabled,
    learningState: state.learningState,
    localPaused: state.localPaused
  });
  await deps.broadcast({ type: allowed ? "content:start" : "content:stop" }, activeDomains);
  return state;
}

/** Sends a message to every tab whose URL belongs to one of the domains. Errors per tab are ignored. */
export function createTabBroadcaster(): SyncDeps["broadcast"] {
  return async (message, domains) => {
    if (domains.length === 0) {
      return;
    }
    const wanted = new Set(domains.map(registrableDomain));
    const tabs = await chrome.tabs.query({});
    await Promise.all(
      tabs.map(async (tab) => {
        const stripped = tab.url ? stripUrl(tab.url) : null;
        if (tab.id === undefined || stripped === null || !wanted.has(stripped.domain)) {
          return;
        }
        try {
          await chrome.tabs.sendMessage(tab.id, message);
        } catch {
          // Tab has no content script (not yet reloaded) - nothing to stop or start.
        }
      })
    );
  };
}
