/** Popup logic: pairing, allowlist display, permission grants, local pause, unpair. No framework. */
import { PRODUCT_NAME } from "@apprentice/schemas";
import { PopupStatusSchema, isErrorResponse, type PopupStatus, type PopupToBackgroundMessage } from "../shared/messages.js";
import { originPatternsForDomain } from "../shared/url.js";

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Missing popup element #${id}`);
  }
  return element as T;
}

const els = {
  productName: byId<HTMLHeadingElement>("product-name"),
  pairingStatus: byId<HTMLParagraphElement>("pairing-status"),
  pairSection: byId<HTMLElement>("pair-section"),
  pairForm: byId<HTMLFormElement>("pair-form"),
  pairCode: byId<HTMLInputElement>("pair-code"),
  pairButton: byId<HTMLButtonElement>("pair-button"),
  pairError: byId<HTMLParagraphElement>("pair-error"),
  pairedSection: byId<HTMLElement>("paired-section"),
  learningState: byId<HTMLElement>("learning-state"),
  captureState: byId<HTMLElement>("capture-state"),
  lastSync: byId<HTMLElement>("last-sync"),
  eventsSent: byId<HTMLElement>("events-sent"),
  allowlist: byId<HTMLUListElement>("allowlist"),
  allowlistEmpty: byId<HTMLParagraphElement>("allowlist-empty"),
  grantButton: byId<HTMLButtonElement>("grant-button"),
  pauseToggle: byId<HTMLInputElement>("pause-toggle"),
  syncButton: byId<HTMLButtonElement>("sync-button"),
  unpairButton: byId<HTMLButtonElement>("unpair-button"),
  actionError: byId<HTMLParagraphElement>("action-error"),
  footerDetail: byId<HTMLParagraphElement>("footer-detail")
};

async function ask(message: PopupToBackgroundMessage): Promise<PopupStatus> {
  const reply: unknown = await chrome.runtime.sendMessage(message);
  if (isErrorResponse(reply)) {
    throw new Error(reply.error);
  }
  const parsed = PopupStatusSchema.safeParse(reply);
  if (!parsed.success) {
    throw new Error("Unexpected reply from the background worker");
  }
  return parsed.data;
}

function formatSync(ts: number | null): string {
  if (ts === null) {
    return "never";
  }
  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
  return seconds < 60 ? `${seconds}s ago` : `${Math.round(seconds / 60)} min ago`;
}

function describeLearning(state: PopupStatus["learningState"]): string {
  switch (state) {
    case "learning":
      return "Learning";
    case "paused":
      return "Paused in app";
    case "private":
      return "Private mode";
    case "stopped":
      return "Stopped";
    default:
      return "Unknown";
  }
}

function renderAllowlist(status: PopupStatus): readonly string[] {
  const granted = new Set(status.grantedDomains);
  const pending = status.allowlist.filter((domain) => !granted.has(domain));
  els.allowlist.replaceChildren(
    ...status.allowlist.map((domain) => {
      const item = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = domain;
      const state = document.createElement("span");
      const isGranted = granted.has(domain);
      state.textContent = isGranted ? "access granted" : "needs access";
      state.className = isGranted ? "granted" : "pending";
      item.append(name, state);
      return item;
    })
  );
  els.allowlistEmpty.hidden = status.allowlist.length > 0;
  els.grantButton.hidden = pending.length === 0;
  els.grantButton.textContent = `Grant access for ${pending.length} ${pending.length === 1 ? "domain" : "domains"}`;
  return pending;
}

let pendingDomains: readonly string[] = [];

function render(status: PopupStatus): void {
  els.productName.textContent = `${status.productName} Browser Companion`;
  els.pairingStatus.textContent = status.paired
    ? `Paired with ${status.productName} on port ${status.port ?? "?"}`
    : "Not paired";
  els.pairingStatus.dataset.state = status.paired ? "paired" : "unpaired";
  els.pairSection.hidden = status.paired;
  els.pairedSection.hidden = !status.paired;
  els.learningState.textContent = describeLearning(status.learningState);
  const capturing = status.paired && status.captureEnabled && status.learningState === "learning" && !status.localPaused;
  els.captureState.textContent = status.localPaused ? "Paused here" : capturing ? "Active" : "Off";
  els.lastSync.textContent = formatSync(status.lastSync);
  els.eventsSent.textContent = String(status.stats.eventsSent);
  els.pauseToggle.checked = status.localPaused;
  els.pauseToggle.setAttribute("aria-checked", String(status.localPaused));
  pendingDomains = renderAllowlist(status);
  els.footerDetail.textContent = status.stats.lastError ? `Last error: ${status.stats.lastError}` : "";
}

function showError(target: HTMLElement, error: unknown): void {
  target.textContent = error instanceof Error ? error.message : String(error);
}

async function refresh(): Promise<void> {
  try {
    render(await ask({ type: "popup:status" }));
  } catch (error) {
    showError(els.actionError, error);
  }
}

els.pairForm.addEventListener("submit", (event) => {
  event.preventDefault();
  els.pairError.textContent = "";
  const code = els.pairCode.value.trim();
  if (!/^[0-9]{6}$/.test(code)) {
    els.pairError.textContent = "Enter the 6-digit code shown in the desktop app.";
    return;
  }
  els.pairButton.disabled = true;
  void ask({ type: "popup:pair", code })
    .then(render)
    .catch((error: unknown) => showError(els.pairError, error))
    .finally(() => {
      els.pairButton.disabled = false;
    });
});

els.grantButton.addEventListener("click", () => {
  els.actionError.textContent = "";
  const origins = pendingDomains.flatMap((domain) => [...originPatternsForDomain(domain)]);
  if (origins.length === 0) {
    return;
  }
  void chrome.permissions
    .request({ origins })
    .then((granted) => {
      if (!granted) {
        els.actionError.textContent = "Access was not granted. Capture stays off for those domains.";
      }
      return ask({ type: "popup:sync" });
    })
    .then(render)
    .catch((error: unknown) => showError(els.actionError, error));
});

els.pauseToggle.addEventListener("change", () => {
  els.actionError.textContent = "";
  void ask({ type: "popup:set-local-pause", paused: els.pauseToggle.checked })
    .then(render)
    .catch((error: unknown) => showError(els.actionError, error));
});

els.syncButton.addEventListener("click", () => {
  els.actionError.textContent = "";
  void ask({ type: "popup:sync" })
    .then(render)
    .catch((error: unknown) => showError(els.actionError, error));
});

els.unpairButton.addEventListener("click", () => {
  els.actionError.textContent = "";
  void ask({ type: "popup:unpair" })
    .then(render)
    .catch((error: unknown) => showError(els.actionError, error));
});

document.title = `${PRODUCT_NAME} Browser Companion`;
void refresh();
