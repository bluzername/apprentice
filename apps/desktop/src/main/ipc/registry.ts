import type { IpcMain, BrowserWindow, IpcMainInvokeEvent } from "electron";
import { ipcContract, ipcEvents, type IpcChannel, type IpcEventName, type IpcEventPayload, type IpcResponse } from "@apprentice/schemas";
import { ZodError, type z } from "zod";

export const IPC_PREFIX = "ipc:";
export const EVENT_PREFIX = "evt:";

export interface IpcContext {
  readonly senderId: number;
}

/** Handlers receive the parsed request (defaults applied), not the raw renderer input. */
export type IpcParsedRequest<C extends IpcChannel> = z.output<(typeof ipcContract)[C]["request"]>;
export type IpcHandler<C extends IpcChannel> = (payload: IpcParsedRequest<C>, ctx: IpcContext) => Promise<IpcResponse<C>> | IpcResponse<C>;
export type IpcHandlers = { [C in IpcChannel]: IpcHandler<C> };

export interface IpcEnvelope<T> {
  readonly ok: boolean;
  readonly data?: T;
  readonly error?: { readonly code: string; readonly message: string; readonly issues?: string[] };
}

export class IpcError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "IpcError";
  }
}

function describeZod(error: ZodError): string[] {
  return error.issues.slice(0, 10).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
}

/**
 * Registers every channel of the typed contract. Requests are validated
 * before the handler runs and responses are validated before they leave the
 * main process. Unknown channels are never registered, so the renderer cannot
 * reach anything outside the contract.
 */
export function registerIpcHandlers(ipcMain: IpcMain, handlers: IpcHandlers, isTrustedSender: (event: IpcMainInvokeEvent) => boolean): void {
  for (const channel of Object.keys(ipcContract) as IpcChannel[]) {
    const { request, response } = ipcContract[channel];
    const handler = handlers[channel] as IpcHandler<IpcChannel>;
    ipcMain.handle(`${IPC_PREFIX}${channel}`, async (event, rawPayload: unknown): Promise<IpcEnvelope<unknown>> => {
      if (!isTrustedSender(event)) {
        return { ok: false, error: { code: "untrusted_sender", message: "IPC request from an untrusted sender was rejected" } };
      }
      const parsedRequest = request.safeParse(rawPayload);
      if (!parsedRequest.success) {
        return { ok: false, error: { code: "invalid_request", message: `Invalid request for ${channel}`, issues: describeZod(parsedRequest.error) } };
      }
      try {
        const result = await handler(parsedRequest.data as never, { senderId: event.sender.id });
        const parsedResponse = response.safeParse(result);
        if (!parsedResponse.success) {
          console.error(`[ipc] response validation failed for ${channel}`, describeZod(parsedResponse.error));
          return { ok: false, error: { code: "invalid_response", message: `Internal response for ${channel} failed validation`, issues: describeZod(parsedResponse.error) } };
        }
        return { ok: true, data: parsedResponse.data };
      } catch (error) {
        if (error instanceof IpcError) return { ok: false, error: { code: error.code, message: error.message } };
        if (error instanceof ZodError) return { ok: false, error: { code: "validation", message: "Validation failed", issues: describeZod(error) } };
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[ipc] ${channel} failed:`, message);
        return { ok: false, error: { code: "internal", message } };
      }
    });
  }
}

/** Sends a validated event to every renderer window. */
export function createEventEmitter(getWindows: () => BrowserWindow[]) {
  return function emit<E extends IpcEventName>(name: E, payload: IpcEventPayload<E>): void {
    const schema = ipcEvents[name];
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      console.error(`[ipc] refusing to emit invalid event ${name}`, describeZod(parsed.error));
      return;
    }
    for (const win of getWindows()) {
      if (!win.isDestroyed()) win.webContents.send(`${EVENT_PREFIX}${name}`, parsed.data);
    }
  };
}
export type EventEmitter = ReturnType<typeof createEventEmitter>;
