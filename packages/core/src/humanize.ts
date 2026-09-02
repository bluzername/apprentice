import { parseToken } from "./normalize/token.js";

function words(label: string): string {
  return label.replace(/-+/g, " ").trim();
}

function capitalize(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}

export function humanizeKeys(keys: string): string {
  const names: Readonly<Record<string, string>> = { cmd: "Cmd", ctrl: "Ctrl", alt: "Option", shift: "Shift" };
  return keys
    .split("+")
    .map((key) => names[key] ?? capitalize(key))
    .join("+");
}

/** Short imperative sentence for one action token, without app or domain context. */
export function humanizeToken(token: string): string {
  const parts = parseToken(token);
  const action = parts["action"];
  const name = parts["name"] !== undefined ? capitalize(words(parts["name"])) : undefined;
  const role = parts["role"] !== undefined ? words(parts["role"]) : undefined;
  switch (action) {
    case "click":
      if (name !== undefined && role !== undefined) return `Click the '${name}' ${role}`;
      if (name !== undefined) return `Click '${name}'`;
      if (role !== undefined) return `Click a ${role}`;
      return "Click";
    case "form-submit": {
      const purpose = parts["purpose"];
      return purpose !== undefined && purpose !== "unknown" ? `Submit the ${words(purpose)} form` : "Submit the form";
    }
    case "navigate":
      return parts["route"] !== undefined ? `Open ${parts["route"]}` : "Navigate";
    case "shortcut":
      return parts["keys"] !== undefined ? `Press ${humanizeKeys(parts["keys"])}` : "Press a shortcut";
    case "download":
      return parts["ext"] !== undefined ? `Download a .${parts["ext"]} file` : "Download a file";
    case "copy":
      return "Copy to the clipboard";
    case "paste":
      return "Paste from the clipboard";
    case "field-input":
      return parts["field"] !== undefined ? `Fill in '${capitalize(words(parts["field"]))}'` : "Fill in a field";
    case "activate":
      return parts["app"] !== undefined ? `Switch to ${capitalize(parts["app"])}` : "Switch app";
    default:
      return action !== undefined ? capitalize(words(action)) : "Unknown action";
  }
}

/** Token sentence followed by its app or domain context when known. */
export function humanizeTokenWithContext(token: string): string {
  const parts = parseToken(token);
  const context = parts["domain"] ?? parts["app"];
  const base = humanizeToken(token);
  return context !== undefined ? `${base} on ${context}` : base;
}

export function humanizeDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) throw new Error("humanizeDuration: invalid duration");
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}
