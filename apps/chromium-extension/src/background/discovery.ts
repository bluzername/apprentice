/** Probes the loopback port range for a running desktop app and caches the winner. */
import { z } from "zod";
import { EXTENSION_PROTOCOL_VERSION, LOOPBACK_PORT_RANGE, PRODUCT_NAME } from "@apprentice/schemas";
import { DISCOVERY_TIMEOUT_MS } from "../shared/constants.js";
import { baseUrlForPort, type FetchImpl } from "./client.js";

export const DiscoverResponseSchema = z.object({
  productName: z.string(),
  protocolVersion: z.string(),
  pairingRequired: z.boolean()
});
export type DiscoverResponse = z.infer<typeof DiscoverResponseSchema>;

export interface DiscoveryOptions {
  readonly fetchImpl: FetchImpl;
  readonly ports?: readonly number[];
  readonly timeoutMs?: number;
  readonly productName?: string;
  readonly protocolVersion?: string;
}

export function portRange(start = LOOPBACK_PORT_RANGE.start, end = LOOPBACK_PORT_RANGE.end): readonly number[] {
  const ports: number[] = [];
  for (let port = start; port <= end; port += 1) {
    ports.push(port);
  }
  return ports;
}

function withTimeout(timeoutMs: number): AbortSignal | undefined {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }
  return undefined;
}

/** Returns the discover payload when `port` hosts the desktop app, otherwise null. Never throws. */
export async function probePort(port: number, options: DiscoveryOptions): Promise<DiscoverResponse | null> {
  const expectedProduct = options.productName ?? PRODUCT_NAME;
  const expectedProtocol = options.protocolVersion ?? EXTENSION_PROTOCOL_VERSION;
  try {
    const response = await options.fetchImpl(`${baseUrlForPort(port)}/v1/discover`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: withTimeout(options.timeoutMs ?? DISCOVERY_TIMEOUT_MS)
    });
    if (!response.ok) {
      return null;
    }
    const parsed = DiscoverResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      return null;
    }
    if (parsed.data.productName !== expectedProduct || parsed.data.protocolVersion !== expectedProtocol) {
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export interface DiscoveryResult {
  readonly port: number;
  readonly info: DiscoverResponse;
}

/** Probes `preferredPort` first (the cached one), then the full range in order. */
export async function discover(options: DiscoveryOptions, preferredPort?: number): Promise<DiscoveryResult | null> {
  const range = options.ports ?? portRange();
  const ordered = preferredPort !== undefined ? [preferredPort, ...range.filter((p) => p !== preferredPort)] : range;
  for (const port of ordered) {
    const info = await probePort(port, options);
    if (info !== null) {
      return { port, info };
    }
  }
  return null;
}
