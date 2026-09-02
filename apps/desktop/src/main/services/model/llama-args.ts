/** Argument builders for llama-server, mirroring scripts/lib/llama-args.mjs exactly. */
import { LOOPBACK_HOST } from "@apprentice/schemas";

export const DEFAULT_ALIAS = "UI_Mate";
export const DEFAULT_CONTEXT_SIZE = 8192;
export const DEFAULT_GPU_LAYERS = 99;

export function assertPort(port: number): number {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new TypeError(`port must be an integer between 1 and 65535, got ${String(port)}`);
  return port;
}

function assertNonEmpty(value: string, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

export interface CommonArgs {
  readonly port: number;
  readonly logPath: string;
  readonly contextSize?: number;
  readonly gpuLayers?: number;
  readonly alias?: string;
}

function commonArgs(args: CommonArgs): string[] {
  assertPort(args.port);
  assertNonEmpty(args.logPath, "logPath");
  return [
    "--host",
    LOOPBACK_HOST,
    "--port",
    String(args.port),
    "-ngl",
    String(args.gpuLayers ?? DEFAULT_GPU_LAYERS),
    "-c",
    String(args.contextSize ?? DEFAULT_CONTEXT_SIZE),
    "--alias",
    args.alias ?? DEFAULT_ALIAS,
    "--log-file",
    args.logPath
  ];
}

export function buildLocalServerArgs(args: CommonArgs & { readonly modelPath: string; readonly mmprojPath: string }): string[] {
  assertNonEmpty(args.modelPath, "modelPath");
  assertNonEmpty(args.mmprojPath, "mmprojPath");
  return ["-m", args.modelPath, "--mmproj", args.mmprojPath, ...commonArgs(args)];
}

export function buildHfServerArgs(args: CommonArgs & { readonly hfSpec: string }): string[] {
  assertNonEmpty(args.hfSpec, "hfSpec");
  return ["-hf", args.hfSpec, ...commonArgs(args)];
}

export function baseUrlForPort(port: number): string {
  return `http://${LOOPBACK_HOST}:${assertPort(port)}/v1`;
}

export function healthUrlForPort(port: number): string {
  return `http://${LOOPBACK_HOST}:${assertPort(port)}/health`;
}
