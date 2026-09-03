import { parseToken } from "./normalize/token.js";

function words(label: string): string {
  return label.replace(/-+/g, " ").trim();
}

function capitalize(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}

const SITE_LABELS: Readonly<Record<string, string>> = {
  gmail: "Gmail",
  "google-sheets": "Google Sheets",
  "google-docs": "Google Docs",
  "google-slides": "Google Slides",
  "google-forms": "Google Forms",
  "google-drive": "Google Drive",
  "google-calendar": "Google Calendar",
  github: "GitHub",
  gitlab: "GitLab",
  notion: "Notion",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  web: "web"
};

/** Mail-like sites show messages rather than pages. */
const PAGE_NOUNS: Readonly<Record<string, string>> = { gmail: "message", outlook: "message", "yahoo-mail": "message" };

function siteLabel(site: string | undefined): string {
  if (site === undefined) return "the site";
  return SITE_LABELS[site] ?? capitalize(words(site));
}

/** "Open Gmail inbox", "Open a Google Sheets document", "Open a Gmail message". */
export function humanizeView(site: string | undefined, view: string | undefined): string {
  const label = siteLabel(site);
  switch (view) {
    case "inbox":
      return `Open ${label} inbox`;
    case "search":
      return `Open ${label} search results`;
    case "compose":
      return `Start a new message in ${label}`;
    case "starred":
      return `Open ${label} starred items`;
    case "sent":
      return `Open ${label} sent mail`;
    case "drafts":
      return `Open ${label} drafts`;
    case "document":
      return `Open a ${label} document`;
    case "settings":
      return `Open ${label} settings`;
    case "login":
      return `Sign in to ${label}`;
    case "checkout":
      return `Open ${label} checkout`;
    default:
      return `Open a ${label} ${PAGE_NOUNS[site ?? ""] ?? "page"}`;
  }
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
    case "view":
      return humanizeView(parts["site"], parts["view"]);
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
