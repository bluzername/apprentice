/**
 * Typed message bus for the background worker. Every inbound message is
 * validated with Zod before dispatch; unknown or malformed messages are
 * answered with an error and never reach a handler.
 */
import {
  InboundMessageSchema,
  errorResponse,
  type ContentToBackgroundMessage,
  type InboundMessage,
  type PopupToBackgroundMessage
} from "../shared/messages.js";

export interface SenderInfo {
  readonly tabId: number | null;
  readonly tabUrl: string | null;
  readonly frameId: number | null;
  readonly fromExtensionPage: boolean;
}

type MessageOf<T extends InboundMessage["type"]> = Extract<InboundMessage, { type: T }>;

export type MessageHandlers = {
  readonly [T in InboundMessage["type"]]: (message: MessageOf<T>, sender: SenderInfo) => Promise<unknown>;
};

export type RuntimeListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void
) => boolean;

export function senderInfoFrom(sender: chrome.runtime.MessageSender, extensionId: string): SenderInfo {
  const fromExtensionPage = sender.id === extensionId && sender.tab === undefined;
  return {
    tabId: sender.tab?.id ?? null,
    tabUrl: sender.tab?.url ?? sender.url ?? null,
    frameId: sender.frameId ?? null,
    fromExtensionPage
  };
}

function isPopupMessage(message: InboundMessage): message is PopupToBackgroundMessage {
  return message.type.startsWith("popup:");
}

function isContentMessage(message: InboundMessage): message is ContentToBackgroundMessage {
  return message.type.startsWith("content:");
}

/** Validates, authorizes by sender, dispatches, and always responds. */
export async function dispatchMessage(
  raw: unknown,
  sender: SenderInfo,
  handlers: MessageHandlers,
  senderExtensionId: string | undefined,
  ownExtensionId: string
): Promise<unknown> {
  if (senderExtensionId !== ownExtensionId) {
    return errorResponse("Messages from other extensions are ignored");
  }
  const parsed = InboundMessageSchema.safeParse(raw);
  if (!parsed.success) {
    return errorResponse("Malformed message");
  }
  const message = parsed.data;
  if (isPopupMessage(message) && !sender.fromExtensionPage) {
    return errorResponse("Popup messages must come from an extension page");
  }
  if (isContentMessage(message) && sender.tabId === null) {
    return errorResponse("Content messages must come from a tab");
  }
  try {
    const handler = handlers[message.type] as (m: InboundMessage, s: SenderInfo) => Promise<unknown>;
    return await handler(message, sender);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    return errorResponse(text.slice(0, 200));
  }
}

export function createRuntimeListener(handlers: MessageHandlers, ownExtensionId: () => string): RuntimeListener {
  return (message, sender, sendResponse) => {
    const id = ownExtensionId();
    void dispatchMessage(message, senderInfoFrom(sender, id), handlers, sender.id, id).then(
      (response) => sendResponse(response),
      (error: unknown) => sendResponse(errorResponse(error instanceof Error ? error.message : "Unknown error"))
    );
    return true;
  };
}
