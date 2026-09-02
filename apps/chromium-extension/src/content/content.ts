/**
 * Content script entry. Registered dynamically by the background worker only
 * for allowlisted, permission-granted domains. It asks the worker whether
 * capture is currently allowed before attaching anything.
 */
import type { ExtensionEvent } from "@apprentice/schemas";
import {
  BackgroundToContentMessageSchema,
  HelloResponseSchema,
  type ContentToBackgroundMessage
} from "../shared/messages.js";
import { stripUrl } from "../shared/url.js";
import { createCaptureSession } from "./capture.js";

const LOADED_FLAG = "__apprenticeCompanionLoaded";

function alreadyLoaded(): boolean {
  const scope = globalThis as Record<string, unknown>;
  if (scope[LOADED_FLAG] === true) {
    return true;
  }
  scope[LOADED_FLAG] = true;
  return false;
}

async function post(message: ContentToBackgroundMessage): Promise<unknown> {
  return chrome.runtime.sendMessage(message);
}

function main(): void {
  if (alreadyLoaded() || typeof chrome === "undefined" || !chrome.runtime?.id) {
    return;
  }
  const here = stripUrl(window.location.href);
  if (here === null) {
    return;
  }

  const session = createCaptureSession(document, window, (event: ExtensionEvent) => {
    void post({ type: "content:event", event }).catch(() => {
      // Extension reloaded or unpaired: stop capturing rather than retrying forever.
      session.detach();
    });
  });

  chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) {
      return false;
    }
    const parsed = BackgroundToContentMessageSchema.safeParse(raw);
    if (!parsed.success) {
      return false;
    }
    const message = parsed.data;
    if (message.type === "content:start") {
      session.attach();
      sendResponse({ ok: true });
    } else if (message.type === "content:stop") {
      session.detach();
      sendResponse({ ok: true });
    } else {
      sendResponse(session.answerDomQuery(message.marker));
    }
    return false;
  });

  void post({ type: "content:hello", domain: here.domain, path: here.path })
    .then((reply) => {
      const parsed = HelloResponseSchema.safeParse(reply);
      if (parsed.success && parsed.data.capture) {
        session.attach();
      }
    })
    .catch(() => undefined);
}

main();
