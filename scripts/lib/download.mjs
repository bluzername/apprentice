/**
 * Resumable, verified downloads. Data is streamed into `<dest>.part`, resumed
 * with HTTP Range requests, hashed after completion and renamed atomically.
 * A file that fails verification is deleted; nothing unverified is kept.
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const SHA256_RE = /^[0-9a-f]{64}$/;

export class VerificationError extends Error {
  constructor(message) {
    super(message);
    this.name = "VerificationError";
  }
}

export class DownloadError extends Error {
  constructor(message) {
    super(message);
    this.name = "DownloadError";
  }
}

export async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

export async function fileSize(path) {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function removeIfExists(path) {
  try {
    await unlink(path);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

export async function verifyFile(path, expectedSha256, expectedSize) {
  if (typeof expectedSha256 !== "string" || !SHA256_RE.test(expectedSha256)) {
    throw new TypeError(`expectedSha256 must be a 64 character hex string, got ${String(expectedSha256)}`);
  }
  const size = await fileSize(path);
  if (size === null) {
    throw new VerificationError(`File not found: ${path}`);
  }
  if (expectedSize !== undefined && size !== expectedSize) {
    throw new VerificationError(`Size mismatch for ${path}: expected ${expectedSize} bytes, found ${size}`);
  }
  const actual = await sha256File(path);
  if (actual !== expectedSha256) {
    throw new VerificationError(`SHA-256 mismatch for ${path}: expected ${expectedSha256}, found ${actual}`);
  }
  return { path, size, sha256: actual };
}

function parseContentRange(header) {
  const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(header ?? "");
  if (!match) {
    return null;
  }
  return { start: Number(match[1]), end: Number(match[2]), total: match[3] === "*" ? undefined : Number(match[3]) };
}

/**
 * Streams the remote body into the part file. Returns the number of bytes
 * written and the offset at which writing started (0 when the server ignored
 * the Range header and the download restarted from scratch).
 */
async function streamToPart({ url, partPath, existing, expectedSize, onProgress, signal, fetchImpl }) {
  const headers = existing > 0 ? { Range: `bytes=${existing}-` } : {};
  const response = await fetchImpl(url, { headers, signal, redirect: "follow" });

  if (response.status === 416) {
    await response.body?.cancel();
    return { written: 0, startedAt: existing };
  }
  if (response.status !== 200 && response.status !== 206) {
    await response.body?.cancel();
    throw new DownloadError(`HTTP ${response.status} ${response.statusText} while fetching ${url}`);
  }

  let startedAt = 0;
  if (response.status === 206) {
    const range = parseContentRange(response.headers.get("content-range"));
    if (!range || range.start !== existing) {
      await response.body?.cancel();
      throw new DownloadError(
        `Server returned Content-Range "${response.headers.get("content-range")}" for a resume at byte ${existing}`
      );
    }
    startedAt = existing;
  }
  if (!response.body) {
    throw new DownloadError(`Empty response body from ${url}`);
  }

  const contentLength = Number(response.headers.get("content-length"));
  const totalBytes = expectedSize ?? (Number.isFinite(contentLength) && contentLength > 0 ? startedAt + contentLength : undefined);
  let received = startedAt;
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      onProgress({ receivedBytes: received, totalBytes, file: partPath });
      callback(null, chunk);
    }
  });
  const sink = createWriteStream(partPath, { flags: startedAt === 0 ? "w" : "a" });
  await pipeline(Readable.fromWeb(response.body), counter, sink, { signal });
  return { written: received - startedAt, startedAt };
}

/**
 * Downloads `url` to `destPath`, resuming a previous partial download when one
 * exists. Resolves with { path, size, sha256, resumedFrom, downloadedBytes,
 * alreadyPresent }. Throws VerificationError (and deletes the file) when the
 * hash or size does not match.
 */
export async function downloadWithResume(url, destPath, options = {}) {
  const { expectedSize, expectedSha256, onProgress = () => {}, signal, fetchImpl = globalThis.fetch } = options;
  if (typeof expectedSha256 !== "string" || !SHA256_RE.test(expectedSha256)) {
    throw new TypeError("downloadWithResume requires expectedSha256 (64 hex characters)");
  }
  if (expectedSize !== undefined && (!Number.isInteger(expectedSize) || expectedSize < 0)) {
    throw new TypeError("expectedSize must be a non-negative integer when provided");
  }
  await mkdir(dirname(destPath), { recursive: true });

  if ((await fileSize(destPath)) !== null) {
    try {
      const verified = await verifyFile(destPath, expectedSha256, expectedSize);
      return { ...verified, resumedFrom: 0, downloadedBytes: 0, alreadyPresent: true };
    } catch (error) {
      if (!(error instanceof VerificationError)) {
        throw error;
      }
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

  let verified;
  try {
    verified = await verifyFile(partPath, expectedSha256, expectedSize);
  } catch (error) {
    if (error instanceof VerificationError) {
      await removeIfExists(partPath);
    }
    throw error;
  }
  await rename(partPath, destPath);
  return { ...verified, path: destPath, resumedFrom, downloadedBytes, alreadyPresent: false };
}
