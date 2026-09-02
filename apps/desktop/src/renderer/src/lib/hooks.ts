import { useCallback, useEffect, useRef, useState } from "react";
import type { IpcEventName, IpcEventPayload } from "@apprentice/schemas";
import { subscribe } from "./api";

export interface LoaderState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
  setData: (updater: (current: T | null) => T | null) => void;
}

/**
 * Runs an async loader whenever its identity changes. Callers must memoise the
 * loader with useCallback so dependencies are explicit.
 */
export function useLoader<T>(loader: () => Promise<T>): LoaderState<T> {
  const [data, setDataState] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const active = useRef(0);

  useEffect(() => {
    const token = ++active.current;
    setLoading(true);
    setError(null);
    loader()
      .then((result) => {
        if (active.current !== token) return;
        setDataState(() => result);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (active.current !== token) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [loader, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback((updater: (current: T | null) => T | null) => setDataState(updater), []);
  return { data, error, loading, reload, setData };
}

/** Subscribes to a main-process event for the component lifetime. */
export function useIpcEvent<E extends IpcEventName>(event: E, handler: (payload: IpcEventPayload<E>) => void): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    try {
      unsubscribe = subscribe(event, (payload) => handlerRef.current(payload));
    } catch {
      unsubscribe = null;
    }
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [event]);
}

/** Runs a callback on an interval while enabled. */
export function useInterval(callback: () => void, ms: number | null): void {
  const saved = useRef(callback);
  saved.current = callback;
  useEffect(() => {
    if (ms === null) return;
    const id = window.setInterval(() => saved.current(), ms);
    return () => window.clearInterval(id);
  }, [ms]);
}

export interface AsyncAction<Args extends unknown[]> {
  run: (...args: Args) => Promise<boolean>;
  busy: boolean;
  error: string | null;
}

/** Wraps an async action with busy and error state. Returns true on success. */
export function useAction<Args extends unknown[]>(action: (...args: Args) => Promise<void>): AsyncAction<Args> {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actionRef = useRef(action);
  actionRef.current = action;
  const run = useCallback(async (...args: Args): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await actionRef.current(...args);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { run, busy, error };
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
