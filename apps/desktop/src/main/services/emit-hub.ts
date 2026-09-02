import type { IpcEventName, IpcEventPayload } from "@apprentice/schemas";
import type { Emit } from "./events.js";

export type EventListener = (name: IpcEventName, payload: unknown) => void;

/**
 * Indirection for the main-to-renderer event channel: services are built before
 * any window exists, so they emit into the hub and the Electron layer attaches
 * the real sink later. Local listeners (tray, smoke test) subscribe too.
 */
export class EmitHub {
  private sink: Emit | null = null;
  private listeners: readonly EventListener[] = [];

  readonly emit: Emit = <E extends IpcEventName>(name: E, payload: IpcEventPayload<E>): void => {
    this.sink?.(name, payload);
    for (const listener of this.listeners) listener(name, payload);
  };

  setSink(sink: Emit | null): void {
    this.sink = sink;
  }

  subscribe(listener: EventListener): () => void {
    this.listeners = [...this.listeners, listener];
    return () => {
      this.listeners = this.listeners.filter((entry) => entry !== listener);
    };
  }
}
