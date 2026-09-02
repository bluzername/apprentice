import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, type JSX, type ReactNode } from "react";
import type { AppSettings, ApprovalRequest, ExtensionStatus, IpcRequest, LearningState, MenuBarStatus, ModelStatus } from "@apprentice/schemas";
import { invoke, subscribe } from "../lib/api";
import { errorMessage } from "../lib/hooks";
import { normalizeRouteInput, parseRoute, type Route } from "../lib/router";
import type { ToastItem, ToastKind } from "../components/Toast";

export interface LearningStatus {
  state: LearningState;
  menuBarStatus: MenuBarStatus;
  pausedUntil?: number;
}

export interface HelperStatus {
  connected: boolean;
  restarts: number;
  message?: string;
}

export interface VersionInfo {
  version: string;
  productName: string;
  helperVersion?: string;
}

export interface AppState {
  route: Route;
  settings: AppSettings | null;
  settingsError: string | null;
  learning: LearningStatus | null;
  /** Set when the last learning:status call failed; cleared by the next successful status. */
  learningError: string | null;
  model: ModelStatus | null;
  /** Set when the last model:status call failed; cleared by the next successful status. */
  modelError: string | null;
  helper: HelperStatus | null;
  extension: ExtensionStatus | null;
  version: VersionInfo | null;
  toasts: ToastItem[];
  pendingApproval: ApprovalRequest | null;
  bridgeMissing: boolean;
}

export type Action =
  | { type: "route"; route: Route }
  | { type: "settings"; settings: AppSettings }
  | { type: "settingsError"; message: string }
  | { type: "learning"; learning: LearningStatus }
  | { type: "learningError"; message: string }
  | { type: "model"; model: ModelStatus }
  | { type: "modelError"; message: string }
  | { type: "helper"; helper: HelperStatus }
  | { type: "extension"; extension: ExtensionStatus }
  | { type: "version"; version: VersionInfo }
  | { type: "toast"; toast: ToastItem }
  | { type: "dismissToast"; id: number }
  | { type: "approval"; approval: ApprovalRequest | null }
  | { type: "bridgeMissing" };

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "route":
      return { ...state, route: action.route };
    case "settings":
      return { ...state, settings: action.settings, settingsError: null };
    case "settingsError":
      return { ...state, settingsError: action.message };
    case "learning":
      return { ...state, learning: action.learning, learningError: null };
    case "learningError":
      return { ...state, learningError: action.message };
    case "model":
      return { ...state, model: action.model, modelError: null };
    case "modelError":
      return { ...state, modelError: action.message };
    case "helper":
      return { ...state, helper: action.helper };
    case "extension":
      return { ...state, extension: action.extension };
    case "version":
      return { ...state, version: action.version };
    case "toast":
      return { ...state, toasts: [...state.toasts.slice(-4), action.toast] };
    case "dismissToast":
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) };
    case "approval":
      return { ...state, pendingApproval: action.approval };
    case "bridgeMissing":
      return { ...state, bridgeMissing: true };
  }
}

export const initialState: AppState = {
  route: parseRoute(typeof window === "undefined" ? "" : window.location.hash),
  settings: null,
  settingsError: null,
  learning: null,
  learningError: null,
  model: null,
  modelError: null,
  helper: null,
  extension: null,
  version: null,
  toasts: [],
  pendingApproval: null,
  bridgeMissing: false
};

export type SettingsPatch = IpcRequest<"settings:update">;

interface StoreValue {
  state: AppState;
  dispatch: (action: Action) => void;
  toast: (kind: ToastKind, message: string) => void;
  updateSettings: (patch: SettingsPatch) => Promise<AppSettings>;
  reloadSettings: () => Promise<void>;
  reloadLearning: () => Promise<void>;
  reloadModel: () => Promise<void>;
  setLearning: (state: LearningState, pauseMinutes?: number) => Promise<void>;
}

const StoreContext = createContext<StoreValue | null>(null);
let toastCounter = 0;

export function StoreProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, dispatch] = useReducer(reducer, initialState);

  const toast = useCallback((kind: ToastKind, message: string) => {
    const id = ++toastCounter;
    dispatch({ type: "toast", toast: { id, kind, message } });
    window.setTimeout(() => dispatch({ type: "dismissToast", id }), kind === "error" ? 9000 : 5000);
  }, []);

  const reloadSettings = useCallback(async () => {
    try {
      dispatch({ type: "settings", settings: await invoke("settings:get") });
    } catch (err) {
      dispatch({ type: "settingsError", message: errorMessage(err) });
    }
  }, []);

  const reloadLearning = useCallback(async () => {
    try {
      dispatch({ type: "learning", learning: await invoke("learning:status") });
    } catch (err) {
      dispatch({ type: "learningError", message: errorMessage(err) });
    }
  }, []);

  const reloadModel = useCallback(async () => {
    try {
      dispatch({ type: "model", model: await invoke("model:status") });
    } catch (err) {
      dispatch({ type: "modelError", message: errorMessage(err) });
    }
  }, []);

  const updateSettings = useCallback(async (patch: SettingsPatch) => {
    const settings = await invoke("settings:update", patch);
    dispatch({ type: "settings", settings });
    return settings;
  }, []);

  const setLearning = useCallback(
    async (learningState: LearningState, pauseMinutes?: number) => {
      const result = await invoke("learning:setState", pauseMinutes ? { state: learningState, pauseMinutes } : { state: learningState });
      dispatch({ type: "learning", learning: result });
    },
    []
  );

  useEffect(() => {
    if (!window.apprentice) {
      dispatch({ type: "bridgeMissing" });
      return;
    }
    void reloadSettings();
    void reloadLearning();
    void reloadModel();
    invoke("app:version").then((version) => dispatch({ type: "version", version })).catch(() => undefined);
    invoke("extension:status").then((extension) => dispatch({ type: "extension", extension })).catch(() => undefined);
    const unsubscribers = [
      subscribe("event:learning", (learning) => dispatch({ type: "learning", learning })),
      subscribe("event:model", (model) => dispatch({ type: "model", model })),
      subscribe("event:helper", (helper) => dispatch({ type: "helper", helper })),
      subscribe("event:extension", (extension) => dispatch({ type: "extension", extension })),
      subscribe("event:toast", (t) => toast(t.kind, t.message)),
      subscribe("event:navigate", (n) => {
        window.location.hash = normalizeRouteInput(n.route);
      }),
      subscribe("event:teachShortcut", () => {
        window.location.hash = "#/teach";
      }),
      subscribe("event:approvalRequest", (approval) => dispatch({ type: "approval", approval })),
      subscribe("event:run", ({ detail }) => {
        if (!detail.pendingApproval) dispatch({ type: "approval", approval: null });
      })
    ];
    return () => unsubscribers.forEach((u) => u());
  }, [reloadSettings, reloadLearning, reloadModel, toast]);

  useEffect(() => {
    const onHash = (): void => dispatch({ type: "route", route: parseRoute(window.location.hash) });
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    const appearance = state.settings?.appearance ?? "system";
    const root = document.documentElement;
    if (appearance === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", appearance);
  }, [state.settings?.appearance]);

  const value = useMemo<StoreValue>(
    () => ({ state, dispatch, toast, updateSettings, reloadSettings, reloadLearning, reloadModel, setLearning }),
    [state, toast, updateSettings, reloadSettings, reloadLearning, reloadModel, setLearning]
  );
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error("useStore must be used inside StoreProvider");
  return value;
}
