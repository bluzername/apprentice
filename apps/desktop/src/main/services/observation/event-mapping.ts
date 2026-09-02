import { normalizeRoute } from "@apprentice/core";
import {
  ClipboardChangedDataSchema,
  FrontmostAppChangedDataSchema,
  IdleChangedDataSchema,
  MouseDownDataSchema,
  SecureFieldFocusedDataSchema,
  ShortcutDataSchema,
  WindowTitleChangedDataSchema,
  type ActivityEvent,
  type ActivityEventType,
  type AppRef,
  type EventPayload,
  type ExtensionEvent,
  type HelperEvent,
  type ScreenshotReason,
  type SemanticElement
} from "@apprentice/schemas";

/** Everything the pipeline needs to build an ActivityEvent from a helper event. */
export interface MappedHelperEvent {
  readonly type: ActivityEventType;
  readonly app?: AppRef;
  readonly payload?: EventPayload;
  /** Focus moved to another app or window: resets privacy-gap dedupe and secure-field pauses. */
  readonly contextChange: boolean;
  /** The event itself is sensitive (secure field): stored without content, capture pauses. */
  readonly sensitive: boolean;
  readonly captureReason?: ScreenshotReason;
  readonly windowTitle?: string;
}

const MAX_TITLE = 160;

export function mapHelperEvent(event: HelperEvent): MappedHelperEvent | null {
  switch (event.event) {
    case "frontmostAppChanged": {
      const data = FrontmostAppChangedDataSchema.parse(event.data);
      return { type: "app_activated", app: { bundleId: data.bundleId, name: data.name }, contextChange: true, sensitive: false, captureReason: "app_change" };
    }
    case "windowTitleChanged": {
      const data = WindowTitleChangedDataSchema.parse(event.data);
      const payload: EventPayload = { title: data.title.slice(0, MAX_TITLE), ...(data.windowId !== undefined ? { windowId: data.windowId } : {}) };
      return { type: "window_title_changed", app: { bundleId: data.bundleId }, payload, contextChange: true, sensitive: false, captureReason: "window_change", windowTitle: data.title };
    }
    case "mouseDown": {
      const data = MouseDownDataSchema.parse(event.data);
      return { type: "mouse_down", app: { bundleId: data.bundleId }, payload: { x: Math.round(data.x), y: Math.round(data.y), button: data.button }, contextChange: false, sensitive: false, captureReason: "click" };
    }
    case "shortcut": {
      const data = ShortcutDataSchema.parse(event.data);
      return { type: "shortcut", app: { bundleId: data.bundleId }, payload: { keys: data.keys.slice(0, 8).map((key) => key.slice(0, 32)) }, contextChange: false, sensitive: false };
    }
    case "clipboardChanged": {
      const data = ClipboardChangedDataSchema.parse(event.data);
      return { type: "clipboard_changed", payload: { changeCount: data.changeCount }, contextChange: false, sensitive: false };
    }
    case "idleChanged": {
      const data = IdleChangedDataSchema.parse(event.data);
      return { type: "idle_changed", payload: { idle: data.idle, idleSeconds: Math.round(data.idleSeconds) }, contextChange: false, sensitive: false };
    }
    case "secureFieldFocused": {
      const data = SecureFieldFocusedDataSchema.parse(event.data);
      return { type: "secure_field_focused", app: { bundleId: data.bundleId }, payload: { role: data.role.slice(0, 64), sensitive: true }, contextChange: false, sensitive: true };
    }
    case "helperReady":
    case "observationState":
      return null;
  }
}

export interface MappedExtensionEvent {
  readonly type: ActivityEventType;
  readonly routePattern?: string;
  readonly element?: SemanticElement;
  readonly payload?: EventPayload;
  readonly sensitive: boolean;
  readonly resumesCapture: boolean;
  readonly captureReason?: ScreenshotReason;
}

const EXTENSION_TYPE: Readonly<Record<ExtensionEvent["type"], ActivityEventType>> = {
  navigation: "navigation",
  page_title: "page_title",
  click: "click",
  form_submit: "form_submit",
  field_input: "field_input",
  copy: "copy",
  paste: "paste",
  download: "download",
  sensitive_pause: "secure_field_focused",
  sensitive_resume: "learning_state_changed"
};

export function mapExtensionEvent(event: ExtensionEvent): MappedExtensionEvent {
  const payload: Record<string, EventPayload[string]> = {};
  if (event.title !== undefined) payload["title"] = event.title.slice(0, MAX_TITLE);
  if (event.formPurpose !== undefined) payload["formPurpose"] = event.formPurpose;
  if (event.fieldLabel !== undefined) payload["fieldLabel"] = event.fieldLabel.slice(0, 80);
  if (event.valueLength !== undefined) payload["valueLength"] = event.valueLength;
  if (event.filenameMeta !== undefined) {
    payload["extension"] = event.filenameMeta.extension.slice(0, 16);
    payload["filenameLength"] = event.filenameMeta.length;
  }
  if (event.sensitiveReason !== undefined) payload["reason"] = event.sensitiveReason;
  const sensitive = event.type === "sensitive_pause";
  if (sensitive) payload["sensitive"] = true;
  const routePattern = event.path !== undefined ? normalizeRoute(event.path) : undefined;
  const captureReason: ScreenshotReason | undefined =
    event.type === "navigation" ? "navigation" : event.type === "click" ? "click" : event.type === "form_submit" ? "form_submit" : undefined;
  return {
    type: EXTENSION_TYPE[event.type],
    routePattern,
    element: event.element,
    payload: Object.keys(payload).length > 0 ? payload : undefined,
    sensitive,
    resumesCapture: event.type === "sensitive_resume",
    captureReason
  };
}

export function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

export type ActivityEventDraft = Omit<ActivityEvent, "id" | "seq" | "sessionId">;
