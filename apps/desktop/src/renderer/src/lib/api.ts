import type { IpcChannel, IpcEventName, IpcEventPayload, IpcRequest, IpcResponse } from "@apprentice/schemas";

export class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly issues: string[] = []) {
    super(message);
    this.name = "ApiError";
  }
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; issues?: string[] };
}

function bridge() {
  const b = window.apprentice;
  if (!b) throw new ApiError("no_bridge", "The desktop bridge is not available. This page must run inside the app.");
  return b;
}

/** Typed request to the main process. Throws ApiError on failure. */
export async function invoke<C extends IpcChannel>(channel: C, ...args: IpcRequest<C> extends undefined | null ? [payload?: IpcRequest<C>] : [payload: IpcRequest<C>]): Promise<IpcResponse<C>> {
  const envelope = (await bridge().invoke(channel, args[0])) as Envelope<IpcResponse<C>>;
  if (!envelope.ok || envelope.data === undefined) {
    const err = envelope.error ?? { code: "unknown", message: "Unknown error" };
    throw new ApiError(err.code, err.message, err.issues ?? []);
  }
  return envelope.data;
}

/** Subscribe to a main-process event. Returns an unsubscribe function. */
export function subscribe<E extends IpcEventName>(event: E, listener: (payload: IpcEventPayload<E>) => void): () => void {
  return bridge().on(event, (payload) => listener(payload as IpcEventPayload<E>));
}
