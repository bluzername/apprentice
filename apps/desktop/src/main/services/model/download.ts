/**
 * TypeScript port of scripts/lib/download.mjs: resumable, verified downloads.
 * Data streams into `<dest>.part`, resumes with Range requests, is hashed after
 * completion, and is renamed atomically. Nothing unverified is kept.
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";

const SHA256_RE = /^[0-9a-f]{64}$/;

export class VerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VerificationError";
  }
}

export class DownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DownloadError";
  }
}

export interface DownloadProgress {
  readonly receivedBytes: number;
  readonly totalBytes?: number;
  readonly file: string;
}

export interface DownloadOptions {
  readonly expectedSize?: number;
  readonly expectedSha256: string;
  readonly onProgress?: (progress: DownloadProgress) => void;
  readonly signal?: AbortSignal;
  readonly fetchImpl?: typeof fetch;
}

export interface DownloadResult {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
  readonly resumedFrom: number;
  readonly downloadedBytes: number;
  readonly alreadyPresent: boolean;
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export async function fileSize(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return null;
    throw error;
  }
}

async function removeIfExists(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") throw error;
  }
}

export async function verifyFile(path: string, expectedSha256: string, expectedSize?: number): Promise<{ path: string; size: number; sha256: string }> {
  if (!SHA256_RE.test(expectedSha256)) throw new TypeError(`expectedSha256 must be a 64 character hex string, got ${expectedSha256}`);
  const size = await fileSize(path);
  if (size === null) throw new VerificationError(`File not found: ${path}`);
  if (expectedSize !== undefined && size !== expectedSize) throw new VerificationError(`Size mismatch for ${path}: expected ${expectedSize} bytes, found ${size}`);
  const actual = await sha256File(path);
  if (actual !== expectedSha256) throw new VerificationError(`SHA-256 mismatch for ${path}: expected ${expectedSha256}, found ${actual}`);
  return { path, size, sha256: actual };
}

function parseContentRange(header: string | null): { start: number; end: number; total?: number } | null {
  const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(header ?? "");
  if (!match) return null;
  return { start: Number(match[1]), end: Number(match[2]), total: match[3] === "*" ? undefined : Number(match[3]) };
}

interface StreamArgs {
  readonly url: string;
  readonly partPath: string;
  readonly existing: number;
  readonly expectedSize?: number;
  readonly onProgress: (progress: DownloadProgress) => void;
  readonly signal?: AbortSignal;
  readonly fetchImpl: typeof fetch;
}

async function streamToPart(args: StreamArgs): Promise<{ written: number; startedAt: number }> {
  const headers: Record<string, string> = args.existing > 0 ? { Range: `bytes=${args.existing}-` } : {};
  const response = await args.fetchImpl(args.url, { headers, signal: args.signal, redirect: "follow" });
  if (response.status === 416) {
    await response.body?.cancel();
    return { written: 0, startedAt: args.existing };
  }
  if (response.status !== 200 && response.status !== 206) {
    await response.body?.cancel();
    throw new DownloadError(`HTTP ${response.status} ${response.statusText} while fetching ${args.url}`);
  }
  let startedAt = 0;
  if (response.status === 206) {
    const range = parseContentRange(response.headers.get("content-range"));
    if (!range || range.start !== args.existing) {
      await response.body?.cancel();
      throw new DownloadError(`Server returned Content-Range "${response.headers.get("content-range") ?? ""}" for a resume at byte ${args.existing}`);
    }
    startedAt = args.existing;
  }
  if (!response.body) throw new DownloadError(`Empty response body from ${args.url}`);
  const contentLength = Number(response.headers.get("content-length"));
  const totalBytes = args.expectedSize ?? (Number.isFinite(contentLength) && contentLength > 0 ? startedAt + contentLength : undefined);
  let received = startedAt;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      args.onProgress({ receivedBytes: received, totalBytes, file: args.partPath });
      callback(null, chunk);
    }
  });
  const sink = createWriteStream(args.partPath, { flags: startedAt === 0 ? "w" : "a" });
  await pipeline(Readable.fromWeb(response.body as ReadableStream), counter, sink, { signal: args.signal });
  return { written: received - startedAt, startedAt };
}

/** Downloads `url` to `destPath`, resuming a partial download when one exists. */
export async function downloadWithResume(url: string, destPath: string, options: DownloadOptions): Promise<DownloadResult> {
  const { expectedSize, expectedSha256, onProgress = () => undefined, signal, fetchImpl = globalThis.fetch } = options;
  if (!SHA256_RE.test(expectedSha256)) throw new TypeError("downloadWithResume requires expectedSha256 (64 hex characters)");
  if (expectedSize !== undefined && (!Number.isInteger(expectedSize) || expectedSize < 0)) throw new TypeError("expectedSize must be a non-negative integer");
  await mkdir(dirname(destPath), { recursive: true });
  if ((await fileSize(destPath)) !== null) {
    try {
      const verified = await verifyFile(destPath, expectedSha256, expectedSize);
      return { ...verified, resumedFrom: 0, downloadedBytes: 0, alreadyPresent: true };
    } catch (error) {
      if (!(error instanceof VerificationError)) throw error;
      await removeIfExists(destPath);
    }
  }
  const partPath = `${destPath}.part`;
  let existing = (await fileSize(partPath)) ?? 0;
  if (expectedSize !== undefined && existing > expectedSize) {
    await removeIfExists(partPath);
    existing = 0;
  }
  let downloadedBytes = 0;
  let resumedFrom = existing;
  if (expectedSize === undefined || existing < expectedSize) {
    const result = await streamToPart({ url, partPath, existing, expectedSize, onProgress, signal, fetchImpl });
    downloadedBytes = result.written;
    resumedFrom = result.startedAt;
  }
  let verified: { path: string; size: number; sha256: string };
  try {
    verified = await verifyFile(partPath, expectedSha256, expectedSize);
  } catch (error) {
    if (error instanceof VerificationError) await removeIfExists(partPath);
    throw error;
  }
  await rename(partPath, destPath);
  return { ...verified, path: destPath, resumedFrom, downloadedBytes, alreadyPresent: false };
}
