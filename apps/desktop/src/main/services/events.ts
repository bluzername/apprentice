import type { IpcEventName, IpcEventPayload } from "@apprentice/schemas";

/** Push channel from main to the renderer; the Electron layer binds it to BrowserWindows. */
export type Emit = <E extends IpcEventName>(name: E, payload: IpcEventPayload<E>) => void;

export interface RecordedEvent {
  readonly name: IpcEventName;
  readonly payload: unknown;
}

/** Test helper: records every emitted event. */
export function createRecordingEmitter(): { emit: Emit; events: RecordedEvent[]; of<E extends IpcEventName>(name: E): IpcEventPayload<E>[] } {
  const events: RecordedEvent[] = [];
  return {
    emit: (name, payload) => {
      events.push({ name, payload });
    },
    events,
    of: (name) => events.filter((entry) => entry.name === name).map((entry) => entry.payload as never)
  };
}

export const noopEmit: Emit = () => undefined;
