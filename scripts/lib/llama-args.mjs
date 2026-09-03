/**
 * Argument builders for llama-server. Kept pure so tests can assert the exact
 * arrays; every value is a separate argv element and never joined into a shell string.
 */
import { LOOPBACK_HOST } from "./spawn.mjs";

export const DEFAULT_ALIAS = "UI_Mate";
export const DEFAULT_CONTEXT_SIZE = 32768;
export const DEFAULT_GPU_LAYERS = 99;

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

export function assertPort(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError(`port must be an integer between 1 and 65535, got ${String(port)}`);
  }
  return port;
}

function commonArgs({ port, logPath, contextSize, gpuLayers, alias }) {
  assertPort(port);
  assertNonEmptyString(logPath, "logPath");
  return [
    "--host",
    LOOPBACK_HOST,
    "--port",
    String(port),
    "-ngl",
    String(gpuLayers),
    "-c",
    String(contextSize),
    "--alias",
    alias,
    "--log-file",
    logPath
  ];
}

export function buildLocalServerArgs({
  modelPath,
  mmprojPath,
  port,
  logPath,
  contextSize = DEFAULT_CONTEXT_SIZE,
  gpuLayers = DEFAULT_GPU_LAYERS,
  alias = DEFAULT_ALIAS
}) {
  assertNonEmptyString(modelPath, "modelPath");
  assertNonEmptyString(mmprojPath, "mmprojPath");
  return ["-m", modelPath, "--mmproj", mmprojPath, ...commonArgs({ port, logPath, contextSize, gpuLayers, alias })];
}

export function buildHfServerArgs({
  hfSpec,
  port,
  logPath,
  contextSize = DEFAULT_CONTEXT_SIZE,
  gpuLayers = DEFAULT_GPU_LAYERS,
  alias = DEFAULT_ALIAS
}) {
  assertNonEmptyString(hfSpec, "hfSpec");
  return ["-hf", hfSpec, ...commonArgs({ port, logPath, contextSize, gpuLayers, alias })];
}

export function baseUrlForPort(port) {
  return `http://${LOOPBACK_HOST}:${assertPort(port)}/v1`;
}

export function healthUrlForPort(port) {
  return `http://${LOOPBACK_HOST}:${assertPort(port)}/health`;
}
