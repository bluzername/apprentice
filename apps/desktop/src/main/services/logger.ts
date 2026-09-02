import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(scope: string): Logger;
}

const LEVEL_RANK: Readonly<Record<LogLevel, number>> = { debug: 0, info: 1, warn: 2, error: 3 };

function formatFields(fields: Record<string, unknown> | undefined): string {
  if (!fields || Object.keys(fields).length === 0) return "";
  try {
    return ` ${JSON.stringify(fields)}`;
  } catch {
    return " [unserializable fields]";
  }
}

export interface LoggerOptions {
  readonly filePath?: string;
  readonly minLevel?: LogLevel;
  readonly console?: boolean;
  readonly scope?: string;
}

/** Line logger writing to a file (no content, no secrets) and optionally to the console. */
export function createLogger(options: LoggerOptions = {}): Logger {
  const minLevel = options.minLevel ?? "info";
  const scope = options.scope ?? "app";
  const toConsole = options.console ?? true;
  if (options.filePath) mkdirSync(dirname(options.filePath), { recursive: true, mode: 0o700 });
  const write = (level: LogLevel, message: string, fields?: Record<string, unknown>): void => {
    if (LEVEL_RANK[level] < LEVEL_RANK[minLevel]) return;
    const line = `${new Date().toISOString()} [${level}] [${scope}] ${message}${formatFields(fields)}`;
    if (options.filePath) {
      try {
        appendFileSync(options.filePath, `${line}\n`, { mode: 0o600 });
      } catch (error) {
        console.error(`[logger] cannot write ${options.filePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (toConsole) {
      if (level === "error") console.error(line);
      else if (level === "warn") console.warn(line);
      else console.log(line);
    }
  };
  return {
    debug: (m, f) => write("debug", m, f),
    info: (m, f) => write("info", m, f),
    warn: (m, f) => write("warn", m, f),
    error: (m, f) => write("error", m, f),
    child: (childScope) => createLogger({ ...options, scope: `${scope}:${childScope}` })
  };
}

export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger
};
