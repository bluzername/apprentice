/**
 * Shared CLI plumbing: flag parsing, stdout/stderr discipline (machine output
 * on stdout, progress on stderr), interactive confirmation and byte formatting.
 */
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";

export class CliError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = "CliError";
    this.extra = extra;
  }
}

export function parseCli(options, argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, options, allowPositionals: false, strict: true });
  return values;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) {
    return "unknown";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 2)} ${units[unit]}`;
}

export function logProgress(message) {
  process.stderr.write(`${message}\n`);
}

/** Returns an onProgress callback that reports at most every `intervalMs` to stderr. */
export function progressReporter(label, intervalMs = 1000) {
  let last = 0;
  return ({ receivedBytes, totalBytes }) => {
    const now = Date.now();
    const done = totalBytes !== undefined && receivedBytes >= totalBytes;
    if (!done && now - last < intervalMs) {
      return;
    }
    last = now;
    const pct = totalBytes ? ` (${((receivedBytes / totalBytes) * 100).toFixed(1)}%)` : "";
    logProgress(`${label}: ${formatBytes(receivedBytes)} / ${totalBytes ? formatBytes(totalBytes) : "?"}${pct}`);
  };
}

export function printResult(result, { json, human }) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const lines = human ? human(result) : [JSON.stringify(result, null, 2)];
  process.stdout.write(`${lines.join("\n")}\n`);
}

/** Asks a yes/no question on the terminal. Non-interactive sessions answer "no". */
export async function confirm(question) {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = (await rl.question(`${question} [yes/no] `)).trim().toLowerCase();
    return answer === "yes" || answer === "y";
  } finally {
    rl.close();
  }
}

export async function requireConsent({ yes, question, hint }) {
  if (yes) {
    return true;
  }
  if (await confirm(question)) {
    return true;
  }
  throw new CliError(`Confirmation required. ${hint}`, { needsConfirmation: true });
}

/** Runs `main`, converting thrown errors into a non-zero exit with JSON or text output. */
export async function runMain(main, { json = false } = {}) {
  try {
    await main();
  } catch (error) {
    const payload = { ok: false, error: error.message, ...(error.extra ?? {}) };
    if (json) {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      process.stderr.write(`Error: ${error.message}\n`);
      if (error.extra?.fallback) {
        process.stderr.write(`${error.extra.fallback}\n`);
      }
    }
    process.exitCode = 1;
  }
}
