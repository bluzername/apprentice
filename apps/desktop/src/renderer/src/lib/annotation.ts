import type { ProposedAction } from "@apprentice/schemas";

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface FitResult {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  scale: number;
}

/** Size and offset of an image fitted with object-fit: contain inside a box. */
export function fitContain(natural: Size, box: Size): FitResult {
  if (natural.width <= 0 || natural.height <= 0 || box.width <= 0 || box.height <= 0) {
    return { width: 0, height: 0, offsetX: 0, offsetY: 0, scale: 0 };
  }
  const scale = Math.min(box.width / natural.width, box.height / natural.height);
  const width = natural.width * scale;
  const height = natural.height * scale;
  return { width, height, offsetX: (box.width - width) / 2, offsetY: (box.height - height) / 2, scale };
}

/** Maps a point in screenshot pixels to CSS pixels of the displayed image. */
export function scalePoint(point: Point, natural: Size, displayed: Size): Point {
  if (natural.width <= 0 || natural.height <= 0) return { x: 0, y: 0 };
  return {
    x: (point.x / natural.width) * displayed.width,
    y: (point.y / natural.height) * displayed.height
  };
}

/** Marker radius scaled with the displayed width, kept in a legible range. */
export function markerRadius(displayedWidth: number): number {
  return Math.round(Math.min(28, Math.max(12, displayedWidth * 0.02)));
}

const MODIFIER_LABELS: Record<string, string> = {
  command: "Command",
  cmd: "Command",
  shift: "Shift",
  alt: "Option",
  option: "Option",
  ctrl: "Control",
  control: "Control"
};

export function keyLabel(key: string): string {
  if (key.length === 1) return key.toUpperCase();
  const map: Record<string, string> = { esc: "Escape", pageup: "Page Up", pagedown: "Page Down" };
  const mapped = map[key];
  if (mapped) return mapped;
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function hotkeyLabel(modifiers: readonly string[], key: string): string {
  return [...modifiers.map((m) => MODIFIER_LABELS[m] ?? m), keyLabel(key)].join(" + ");
}

/** Target point for actions that have coordinates, otherwise null. */
export function actionTarget(action: ProposedAction): Point | null {
  switch (action.type) {
    case "click":
    case "double_click":
    case "move":
    case "scroll":
      return { x: action.x, y: action.y };
    default:
      return null;
  }
}

/** Plain-language description of an action, never including hidden reasoning. */
export function describeAction(action: ProposedAction): string {
  switch (action.type) {
    case "click":
      return `${action.button === "left" ? "Click" : `${action.button} click`} at (${Math.round(action.x)}, ${Math.round(action.y)})`;
    case "double_click":
      return `Double-click at (${Math.round(action.x)}, ${Math.round(action.y)})`;
    case "move":
      return `Move pointer to (${Math.round(action.x)}, ${Math.round(action.y)})`;
    case "scroll":
      return `Scroll ${action.deltaY < 0 ? "up" : action.deltaY > 0 ? "down" : "horizontally"} at (${Math.round(action.x)}, ${Math.round(action.y)})`;
    case "type_text":
      return `Type ${action.text.length} character${action.text.length === 1 ? "" : "s"}`;
    case "press_key":
      return `Press ${keyLabel(action.key)}`;
    case "hotkey":
      return `Press ${hotkeyLabel(action.modifiers, action.key)}`;
    case "wait":
      return `Wait ${Math.round(action.ms / 100) / 10}s`;
    case "ask_user":
      return "Ask you a question";
    case "done":
      return "Mark the task as done";
    case "fail":
      return "Report that the task cannot continue";
  }
}

/**
 * Marker position inside the screenshot box: the image is centered in its
 * container (object-fit: contain), so the container-relative position is the
 * image's offset plus the point scaled into the displayed image.
 */
export function markerPosition(point: Point, natural: Size, displayed: Size, imageOffset: Point): Point {
  const scaled = scalePoint(point, natural, displayed);
  return { x: imageOffset.x + scaled.x, y: imageOffset.y + scaled.y };
}
