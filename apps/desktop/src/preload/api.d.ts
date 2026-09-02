export interface ApprenticeBridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
  on(event: string, listener: (payload: unknown) => void): () => void;
  readonly channels: readonly string[];
  readonly events: readonly string[];
}
declare global {
  interface Window {
    apprentice: ApprenticeBridge;
  }
}
export {};
