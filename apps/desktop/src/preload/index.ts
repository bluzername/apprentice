import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS, IPC_EVENT_NAMES } from "@apprentice/schemas";

const IPC_PREFIX = "ipc:";
const EVENT_PREFIX = "evt:";
const channelSet = new Set<string>(IPC_CHANNELS);
const eventSet = new Set<string>(IPC_EVENT_NAMES);

/**
 * The only bridge between renderer and main. It forwards whitelisted channel
 * names and nothing else; no Node or Electron objects leak into the page.
 */
const api = Object.freeze({
  invoke(channel: string, payload?: unknown): Promise<unknown> {
    if (!channelSet.has(channel)) return Promise.reject(new Error(`Unknown IPC channel: ${channel}`));
    return ipcRenderer.invoke(`${IPC_PREFIX}${channel}`, payload ?? null);
  },
  on(event: string, listener: (payload: unknown) => void): () => void {
    if (!eventSet.has(event)) throw new Error(`Unknown IPC event: ${event}`);
    const wrapped = (_e: Electron.IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on(`${EVENT_PREFIX}${event}`, wrapped);
    return () => ipcRenderer.off(`${EVENT_PREFIX}${event}`, wrapped);
  },
  channels: Object.freeze([...IPC_CHANNELS]),
  events: Object.freeze([...IPC_EVENT_NAMES])
});

contextBridge.exposeInMainWorld("apprentice", api);
export type PreloadApi = typeof api;
