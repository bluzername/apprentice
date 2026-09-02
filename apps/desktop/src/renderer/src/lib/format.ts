import type { FailureCategory, MenuBarStatus, RiskClass, RunStatus } from "@apprentice/schemas";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "2h 5m", "3m 20s", "45s". Never returns an empty string. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  return `${seconds}s`;
}

/** Minutes to a compact label: 90 -> "1h 30m", 12.4 -> "12m". */
export function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0m";
  return formatDuration(Math.round(minutes) * MINUTE);
}

export function formatHours(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return "0h";
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  return `${Math.round(hours * 10) / 10}h`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : value < 10 ? 1 : 0;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function formatTimeWithSeconds(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(ts: number): string {
  return `${formatDate(ts)} ${formatTime(ts)}`;
}

/** "just now", "5m ago", "3h ago", "2d ago". */
export function formatRelative(ts: number, now = Date.now()): string {
  const delta = now - ts;
  if (delta < MINUTE) return "just now";
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`;
  return `${Math.floor(delta / DAY)}d ago`;
}

export function formatPercent(unit: number): string {
  if (!Number.isFinite(unit)) return "0%";
  return `${Math.round(Math.min(1, Math.max(0, unit)) * 100)}%`;
}

/** Start of the hour containing ts (local time), used for timeline grouping. */
export function hourKey(ts: number): number {
  const d = new Date(ts);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** snake_case or kebab-case token to a sentence: "not_useful" -> "Not useful". */
export function humanize(token: string): string {
  const spaced = token.replace(/[_-]+/g, " ").trim();
  if (spaced.length === 0) return "";
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Value for <input type="datetime-local" step="1"> in local time. */
export function toDatetimeLocal(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Parses a datetime-local string. Returns null when invalid. */
export function fromDatetimeLocal(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

const RISK_LABELS: Record<RiskClass, string> = {
  read_only: "Read only",
  reversible_navigation: "Navigation",
  internal_mutation: "Internal change",
  external_communication: "External communication",
  destructive: "Destructive",
  financial_or_access: "Financial or access",
  sensitive_context: "Sensitive context",
  unknown: "Unknown risk"
};

export type RiskTone = "low" | "medium" | "high" | "neutral";

const RISK_TONES: Record<RiskClass, RiskTone> = {
  read_only: "low",
  reversible_navigation: "low",
  internal_mutation: "medium",
  external_communication: "high",
  destructive: "high",
  financial_or_access: "high",
  sensitive_context: "high",
  unknown: "neutral"
};

export function riskLabel(risk: RiskClass): string {
  return RISK_LABELS[risk];
}

export function riskTone(risk: RiskClass): RiskTone {
  return RISK_TONES[risk];
}

const STATUS_LABELS: Record<MenuBarStatus, string> = {
  learning: "Learning",
  paused: "Paused",
  private: "Private",
  processing_locally: "Processing locally",
  model_unavailable: "Model unavailable",
  stopped: "Stopped"
};

export function menuBarStatusLabel(status: MenuBarStatus): string {
  return STATUS_LABELS[status];
}

const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  pending: "Pending",
  running: "Running",
  awaiting_approval: "Waiting for approval",
  awaiting_user: "Waiting for you",
  completed: "Completed",
  failed: "Failed",
  interrupted: "Interrupted",
  timed_out: "Timed out",
  aborted_policy: "Stopped by policy",
  aborted_sensitive: "Stopped: sensitive context"
};

export function runStatusLabel(status: RunStatus): string {
  return RUN_STATUS_LABELS[status];
}

export function isRunActive(status: RunStatus): boolean {
  return status === "pending" || status === "running" || status === "awaiting_approval" || status === "awaiting_user";
}

export function failureLabel(category: FailureCategory): string {
  return category === "none" ? "None" : humanize(category);
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
