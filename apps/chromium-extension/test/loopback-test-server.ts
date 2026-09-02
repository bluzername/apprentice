/**
 * Minimal Node http implementation of the loopback protocol used by the
 * client tests. It checks the bearer token, the Origin header, and can be
 * switched into rate-limit mode.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { EXTENSION_PROTOCOL_VERSION, PRODUCT_NAME, PairRequestSchema, ExtensionEventBatchSchema } from "@apprentice/schemas";

export interface TestServerOptions {
  readonly expectedOrigin: string;
  readonly pairingCode?: string;
  readonly token?: string;
  readonly productName?: string;
}

export interface TestServer {
  readonly port: number;
  readonly received: { events: unknown[]; domStates: unknown[] };
  setRateLimited(limited: boolean): void;
  setPendingQuery(marker: string | null): void;
  setAllowlist(update: Partial<AllowlistBody>): void;
  close(): Promise<void>;
}

export interface AllowlistBody {
  domains: string[];
  learningState: "learning" | "paused" | "private" | "stopped";
  captureEnabled: boolean;
  productName: string;
  runActive?: boolean;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text.length === 0 ? undefined : (JSON.parse(text) as unknown);
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

export async function startTestServer(options: TestServerOptions): Promise<TestServer> {
  const token = options.token ?? "test-token-0123456789abcdef0123456789abcdef";
  const code = options.pairingCode ?? "123456";
  const productName = options.productName ?? PRODUCT_NAME;
  const received: TestServer["received"] = { events: [], domStates: [] };
  let rateLimited = false;
  let pendingQuery: string | null = null;
  let allowlist: AllowlistBody = { domains: ["example.com"], learningState: "learning", captureEnabled: true, productName };

  const authorized = (req: IncomingMessage, res: ServerResponse): boolean => {
    if (req.headers.origin !== options.expectedOrigin) {
      send(res, 403, { error: "origin mismatch" });
      return false;
    }
    if (req.headers.authorization !== `Bearer ${token}`) {
      send(res, 401, { error: "bad token" });
      return false;
    }
    return true;
  };

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = req.url ?? "/";
      if (rateLimited) {
        send(res, 429, { error: "slow down" }, { "Retry-After": "2" });
        return;
      }
      if (req.method === "GET" && url === "/v1/discover") {
        send(res, 200, { productName, protocolVersion: EXTENSION_PROTOCOL_VERSION, pairingRequired: true });
        return;
      }
      if (req.method === "POST" && url === "/v1/pair") {
        if (req.headers.origin !== options.expectedOrigin) {
          send(res, 403, { error: "origin mismatch" });
          return;
        }
        const parsed = PairRequestSchema.safeParse(await readJson(req));
        if (!parsed.success || parsed.data.code !== code) {
          send(res, 401, { error: "bad code" });
          return;
        }
        send(res, 200, { token, protocolVersion: EXTENSION_PROTOCOL_VERSION, productName });
        return;
      }
      if (!authorized(req, res)) {
        return;
      }
      if (req.method === "POST" && url === "/v1/events") {
        const parsed = ExtensionEventBatchSchema.safeParse(await readJson(req));
        if (!parsed.success) {
          send(res, 400, { error: "bad batch" });
          return;
        }
        received.events.push(...parsed.data.events);
        send(res, 200, { accepted: parsed.data.events.length, dropped: 0 });
        return;
      }
      if (req.method === "GET" && url === "/v1/allowlist") {
        send(res, 200, allowlist);
        return;
      }
      if (req.method === "GET" && url === "/v1/dom-query") {
        send(res, 200, { query: pendingQuery === null ? null : { marker: pendingQuery } });
        return;
      }
      if (req.method === "POST" && url === "/v1/dom-state") {
        received.domStates.push(await readJson(req));
        pendingQuery = null;
        send(res, 200, { ok: true });
        return;
      }
      send(res, 404, { error: "not found" });
    })().catch(() => send(res, 500, { error: "server error" }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    received,
    setRateLimited: (limited) => {
      rateLimited = limited;
    },
    setPendingQuery: (marker) => {
      pendingQuery = marker;
    },
    setAllowlist: (update) => {
      allowlist = { ...allowlist, ...update };
    },
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}
