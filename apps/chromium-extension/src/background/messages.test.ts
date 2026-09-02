import { describe, expect, it, vi } from "vitest";
import { createRuntimeListener, dispatchMessage, senderInfoFrom, type MessageHandlers, type SenderInfo } from "./messages.js";

const OWN_ID = "abcdefghijklmnopabcdefghijklmnop";
const tabSender: SenderInfo = { tabId: 7, tabUrl: "https://app.example.com/x", frameId: 0, fromExtensionPage: false };
const popupSender: SenderInfo = { tabId: null, tabUrl: null, frameId: null, fromExtensionPage: true };

function handlers(overrides: Partial<MessageHandlers> = {}): MessageHandlers {
  const reply = async () => ({ ok: true });
  return {
    "content:hello": async () => ({ ok: true, capture: true }),
    "content:event": reply,
    "content:dom-state": reply,
    "popup:status": reply,
    "popup:pair": reply,
    "popup:unpair": reply,
    "popup:set-local-pause": reply,
    "popup:sync": reply,
    ...overrides
  };
}

describe("dispatchMessage", () => {
  it("routes validated content messages to their handler", async () => {
    const hello = vi.fn(async () => ({ ok: true as const, capture: false }));
    const result = await dispatchMessage(
      { type: "content:hello", domain: "example.com", path: "/x" },
      tabSender,
      handlers({ "content:hello": hello }),
      OWN_ID,
      OWN_ID
    );
    expect(result).toEqual({ ok: true, capture: false });
    expect(hello).toHaveBeenCalledWith({ type: "content:hello", domain: "example.com", path: "/x" }, tabSender);
  });

  it("rejects malformed messages without calling handlers", async () => {
    const hello = vi.fn();
    const result = await dispatchMessage({ type: "content:hello" }, tabSender, handlers({ "content:hello": hello }), OWN_ID, OWN_ID);
    expect(result).toEqual({ ok: false, error: "Malformed message" });
    expect(hello).not.toHaveBeenCalled();
  });

  it("rejects messages from other extensions", async () => {
    const result = await dispatchMessage({ type: "popup:status" }, popupSender, handlers(), "otherextension", OWN_ID);
    expect(result).toMatchObject({ ok: false });
  });

  it("refuses popup messages from tabs and content messages from extension pages", async () => {
    expect(await dispatchMessage({ type: "popup:unpair" }, tabSender, handlers(), OWN_ID, OWN_ID)).toMatchObject({ ok: false });
    expect(
      await dispatchMessage({ type: "content:hello", domain: "example.com", path: "/" }, popupSender, handlers(), OWN_ID, OWN_ID)
    ).toMatchObject({ ok: false });
  });

  it("converts handler exceptions into error responses", async () => {
    const failing = handlers({
      "popup:pair": async () => {
        throw new Error("Desktop app not found");
      }
    });
    expect(await dispatchMessage({ type: "popup:pair", code: "123456" }, popupSender, failing, OWN_ID, OWN_ID)).toEqual({
      ok: false,
      error: "Desktop app not found"
    });
  });
});

describe("createRuntimeListener", () => {
  it("returns true to keep the channel open and responds asynchronously", async () => {
    const listener = createRuntimeListener(handlers(), () => OWN_ID);
    const sendResponse = vi.fn();
    const sender = { id: OWN_ID } as chrome.runtime.MessageSender;
    expect(listener({ type: "popup:status" }, sender, sendResponse)).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
  });

  it("derives sender info from chrome's MessageSender", () => {
    const info = senderInfoFrom({ id: OWN_ID, tab: { id: 3, url: "https://a.example.com/" } as chrome.tabs.Tab, frameId: 0 }, OWN_ID);
    expect(info).toEqual({ tabId: 3, tabUrl: "https://a.example.com/", frameId: 0, fromExtensionPage: false });
    expect(senderInfoFrom({ id: OWN_ID, url: `chrome-extension://${OWN_ID}/popup.html` }, OWN_ID).fromExtensionPage).toBe(true);
  });
});
