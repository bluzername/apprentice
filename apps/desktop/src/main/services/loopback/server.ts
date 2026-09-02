import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  AllowlistResponseSchema,
  EXTENSION_PROTOCOL_VERSION,
  ExtensionEventBatchSchema,
  LOOPBACK_HOST,
  LOOPBACK_PORT_RANGE,
  PRODUCT_NAME,
  PairRequestSchema,
  type DomStateResult,
  type ExtensionEvent,
  type ExtensionStatus,
  type LearningState
} from "@apprentice/schemas";
import { z } from "zod";
import type { StorageRef } from "../app-context.js";
import type { Clock } from "../clock.js";
import { ServiceError } from "../errors.js";
import type { Emit } from "../events.js";
import type { Logger } from "../logger.js";
import type { SettingsStore } from "../settings-store.js";
import { PairingManager } from "./pairing.js";
import { RateLimiter } from "./rate-limit.js";

const BODY_LIMIT_BYTES = 64 * 1024;
const RATE_WINDOW_MS = 10_000;
const CLIENT_RATE_LIMIT = 30;
const DISCOVER_RATE_LIMIT = 10;

const DomStatePostSchema = z.object({ marker: z.string().max(160), present: z.boolean(), domain: z.string().max(253).optional(), path: z.string().max(512).optional() }).strict();

export interface LoopbackServerDeps {
  readonly storage: StorageRef;
  readonly settings: SettingsStore;
  readonly ingest: (events: readonly ExtensionEvent[]) => { accepted: number; dropped: number };
  readonly learningState: () => LearningState;
  readonly runActive: () => boolean;
  readonly emit: Emit;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly portRange?: { start: number; end: number };
  readonly host?: string;
}

interface PendingDomQuery {
  readonly marker: string;
  readonly resolve: (result: DomStateResult | null) => void;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers: Record<string, string> = {}
  ) {
    super(message);
  }
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] ?? "0");
    if (Number.isFinite(declared) && declared > BODY_LIMIT_BYTES) {
      reject(new HttpError(413, "payload_too_large", `Body exceeds ${BODY_LIMIT_BYTES} bytes`));
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > BODY_LIMIT_BYTES) {
        reject(new HttpError(413, "payload_too_large", `Body exceeds ${BODY_LIMIT_BYTES} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid_json", "Body is not valid JSON");
  }
}

/**
 * Loopback API for the browser extension: discovery, pairing, event ingestion,
 * allowlist sync, and the DOM state exchange used by run verification.
 */
export class LoopbackServer {
  private server: Server | null = null;
  private listeningPort: number | null = null;
  private readonly pairing: PairingManager;
  private readonly clientLimiter: RateLimiter;
  private readonly discoverLimiter: RateLimiter;
  private pendingDom: PendingDomQuery | null = null;

  constructor(private readonly deps: LoopbackServerDeps) {
    this.pairing = new PairingManager(() => deps.storage.current.pairing, () => deps.clock.now());
    this.clientLimiter = new RateLimiter(CLIENT_RATE_LIMIT, RATE_WINDOW_MS, () => deps.clock.now());
    this.discoverLimiter = new RateLimiter(DISCOVER_RATE_LIMIT, RATE_WINDOW_MS, () => deps.clock.now());
  }

  get port(): number | null {
    return this.listeningPort;
  }

  async start(): Promise<number> {
    if (this.listeningPort !== null) return this.listeningPort;
    const range = this.deps.portRange ?? LOOPBACK_PORT_RANGE;
    const host = this.deps.host ?? LOOPBACK_HOST;
    for (let port = range.start; port <= range.end; port += 1) {
      const server = createServer((req, res) => void this.handle(req, res));
      const bound = await new Promise<boolean>((resolve) => {
        server.once("error", () => resolve(false));
        server.listen(port, host, () => resolve(true));
      });
      if (bound) {
        this.server = server;
        this.listeningPort = port;
        this.deps.logger.info("loopback server listening", { port });
        return port;
      }
      server.removeAllListeners();
    }
    throw new ServiceError("loopback_unavailable", `No free loopback port in ${range.start}-${range.end}`);
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.listeningPort = null;
    this.resolveDom(null);
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  issuePairingCode(): { code: string; expiresAt: number; port: number } {
    if (this.listeningPort === null) throw new ServiceError("loopback_unavailable", "The loopback server is not running");
    const issued = this.pairing.issue();
    return { code: issued.code, expiresAt: issued.expiresAt, port: this.listeningPort };
  }

  status(): ExtensionStatus {
    const record = this.deps.storage.current.pairing.get();
    return {
      paired: record !== null,
      extensionId: record?.extensionId,
      browser: record?.browser,
      lastSeenTs: record?.lastSeen ?? undefined,
      eventsReceived: record?.eventsReceived ?? 0,
      port: this.listeningPort ?? undefined
    };
  }

  unpair(): ExtensionStatus {
    this.pairing.clear();
    this.resolveDom(null);
    const status = this.status();
    this.deps.emit("event:extension", status);
    return status;
  }

  /** Asks the paired extension whether a DOM marker is present; null when unpaired or timed out. */
  queryDomState(marker: string, timeoutMs: number): Promise<DomStateResult | null> {
    if (this.deps.storage.current.pairing.get() === null) return Promise.resolve(null);
    this.resolveDom(null);
    return new Promise<DomStateResult | null>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingDom?.resolve === wrapped) this.pendingDom = null;
        resolve(null);
      }, timeoutMs);
      timer.unref?.();
      const wrapped = (result: DomStateResult | null): void => {
        clearTimeout(timer);
        resolve(result);
      };
      this.pendingDom = { marker, resolve: wrapped };
    });
  }

  private resolveDom(result: DomStateResult | null): void {
    const pending = this.pendingDom;
    this.pendingDom = null;
    pending?.resolve(result);
  }

  private clientKey(req: IncomingMessage): string {
    return req.socket.remoteAddress ?? "unknown";
  }

  private authenticate(req: IncomingMessage): { extensionId: string } {
    const record = this.deps.storage.current.pairing.get();
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!record || token.length === 0 || !this.pairing.verifyToken(token)) throw new HttpError(401, "unauthorized", "Pairing token missing or rejected");
    const origin = req.headers.origin ?? "";
    if (origin !== `chrome-extension://${record.extensionId}`) throw new HttpError(403, "forbidden", "Origin does not match the paired extension");
    return { extensionId: record.extensionId };
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? "/", `http://${LOOPBACK_HOST}`);
      const route = `${req.method ?? "GET"} ${url.pathname}`;
      if (route === "GET /v1/discover") return this.discover(req, res);
      if (route === "POST /v1/pair") return await this.pair(req, res);
      const auth = this.authenticate(req);
      const key = `${this.clientKey(req)}:${auth.extensionId}`;
      if (!this.clientLimiter.allow(key)) throw new HttpError(429, "rate_limited", "Too many requests", { "Retry-After": String(this.clientLimiter.retryAfterSeconds(key)) });
      if (route === "POST /v1/events") return await this.events(req, res);
      if (route === "GET /v1/allowlist") return this.allowlist(res);
      if (route === "GET /v1/dom-query") return send(res, 200, { query: this.pendingDom ? { marker: this.pendingDom.marker } : null });
      if (route === "POST /v1/dom-state") return await this.domState(req, res);
      throw new HttpError(404, "not_found", "Unknown route");
    } catch (error) {
      if (error instanceof HttpError) {
        send(res, error.status, { error: error.code, message: error.message }, error.headers);
        return;
      }
      this.deps.logger.error("loopback request failed", { error: error instanceof Error ? error.message : String(error) });
      send(res, 500, { error: "internal", message: "Internal error" });
    }
  }

  private discover(req: IncomingMessage, res: ServerResponse): void {
    const key = this.clientKey(req);
    if (!this.discoverLimiter.allow(key)) throw new HttpError(429, "rate_limited", "Too many discovery requests", { "Retry-After": String(this.discoverLimiter.retryAfterSeconds(key)) });
    send(res, 200, { productName: PRODUCT_NAME, protocolVersion: EXTENSION_PROTOCOL_VERSION, pairingRequired: this.deps.storage.current.pairing.get() === null });
  }

  private async pair(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const key = `pair:${this.clientKey(req)}`;
    if (!this.discoverLimiter.allow(key)) throw new HttpError(429, "rate_limited", "Too many pairing attempts", { "Retry-After": String(this.discoverLimiter.retryAfterSeconds(key)) });
    const parsed = PairRequestSchema.safeParse(parseJson(await readBody(req)));
    if (!parsed.success) throw new HttpError(400, "invalid_request", "Pair request failed validation");
    const outcome = this.pairing.attempt(parsed.data.code, parsed.data.extensionId, parsed.data.browser);
    if (!outcome.ok) {
      const status = outcome.reason === "mismatch" ? 401 : 403;
      throw new HttpError(status, `pairing_${outcome.reason}`, `Pairing rejected: ${outcome.reason}`);
    }
    const status = this.status();
    this.deps.emit("event:extension", status);
    this.deps.logger.info("extension paired", { browser: parsed.data.browser });
    send(res, 200, { token: outcome.token, protocolVersion: EXTENSION_PROTOCOL_VERSION, productName: PRODUCT_NAME });
  }

  private async events(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const parsed = ExtensionEventBatchSchema.safeParse(parseJson(await readBody(req)));
    if (!parsed.success) throw new HttpError(400, "invalid_request", "Event batch failed validation");
    const result = this.deps.ingest(parsed.data.events);
    this.deps.storage.current.pairing.touch(result.accepted, this.deps.clock.now());
    this.deps.emit("event:extension", this.status());
    send(res, 200, result);
  }

  private allowlist(res: ServerResponse): void {
    const state = this.deps.learningState();
    const body = AllowlistResponseSchema.parse({
      domains: this.deps.settings.get().allowlist.domains,
      learningState: state,
      captureEnabled: state === "learning",
      productName: PRODUCT_NAME,
      runActive: this.deps.runActive()
    });
    send(res, 200, body);
  }

  private async domState(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const parsed = DomStatePostSchema.safeParse(parseJson(await readBody(req)));
    if (!parsed.success) throw new HttpError(400, "invalid_request", "DOM state failed validation");
    if (this.pendingDom && this.pendingDom.marker === parsed.data.marker) this.resolveDom(parsed.data);
    send(res, 200, { ok: true });
  }
}
