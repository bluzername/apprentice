import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DownloadError, VerificationError, downloadWithResume, sha256File, verifyFile } from "./download.mjs";

const SIZE = 1024 * 1024;
const PAYLOAD = randomBytes(SIZE);
const PAYLOAD_SHA = createHash("sha256").update(PAYLOAD).digest("hex");
const WRONG_SHA = "0".repeat(64);
const CHUNK = 16 * 1024;

function startServer({ supportRange = true, status = 200 } = {}) {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ range: req.headers.range ?? null });
    if (status !== 200) {
      res.writeHead(status);
      res.end();
      return;
    }
    const match = supportRange && req.headers.range ? /^bytes=(\d+)-$/.exec(req.headers.range) : null;
    const start = match ? Number(match[1]) : 0;
    if (start >= SIZE) {
      res.writeHead(416, { "Content-Range": `bytes */${SIZE}` });
      res.end();
      return;
    }
    res.writeHead(match ? 206 : 200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": SIZE - start,
      "Accept-Ranges": "bytes",
      ...(match ? { "Content-Range": `bytes ${start}-${SIZE - 1}/${SIZE}` } : {})
    });
    let offset = start;
    let closed = false;
    res.on("close", () => {
      closed = true;
    });
    const pump = () => {
      if (closed) {
        return;
      }
      if (offset >= SIZE) {
        res.end();
        return;
      }
      res.write(PAYLOAD.subarray(offset, Math.min(offset + CHUNK, SIZE)));
      offset += CHUNK;
      setTimeout(pump, 1);
    };
    pump();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}/file.bin`,
        requests,
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}

describe("download", () => {
  const cleanups = [];
  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()();
    }
  });

  async function tempDir() {
    const dir = await mkdtemp(join(tmpdir(), "apprentice-download-"));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    return dir;
  }

  async function server(options) {
    const s = await startServer(options);
    cleanups.push(s.close);
    return s;
  }

  it("sha256File hashes a file", async () => {
    const dir = await tempDir();
    const file = join(dir, "a.bin");
    await writeFile(file, PAYLOAD);
    expect(await sha256File(file)).toBe(PAYLOAD_SHA);
  });

  it("verifyFile accepts a matching file and rejects size or hash mismatches", async () => {
    const dir = await tempDir();
    const file = join(dir, "a.bin");
    await writeFile(file, PAYLOAD);
    await expect(verifyFile(file, PAYLOAD_SHA, SIZE)).resolves.toMatchObject({ size: SIZE, sha256: PAYLOAD_SHA });
    await expect(verifyFile(file, PAYLOAD_SHA, SIZE - 1)).rejects.toBeInstanceOf(VerificationError);
    await expect(verifyFile(file, WRONG_SHA, SIZE)).rejects.toBeInstanceOf(VerificationError);
    await expect(verifyFile(join(dir, "missing"), PAYLOAD_SHA)).rejects.toBeInstanceOf(VerificationError);
    await expect(verifyFile(file, "nothex")).rejects.toBeInstanceOf(TypeError);
  });

  it("resumes an interrupted download with a Range request and verifies the hash", async () => {
    const dir = await tempDir();
    const { url, requests } = await server();
    const dest = join(dir, "resume.bin");
    const controller = new AbortController();
    let aborted = false;
    await expect(
      downloadWithResume(url, dest, {
        expectedSize: SIZE,
        expectedSha256: PAYLOAD_SHA,
        signal: controller.signal,
        onProgress: ({ receivedBytes }) => {
          if (!aborted && receivedBytes >= 300 * 1024) {
            aborted = true;
            controller.abort();
          }
        }
      })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(aborted).toBe(true);
    expect(existsSync(dest)).toBe(false);
    const partial = await stat(`${dest}.part`);
    expect(partial.size).toBeGreaterThan(0);
    expect(partial.size).toBeLessThan(SIZE);

    const result = await downloadWithResume(url, dest, { expectedSize: SIZE, expectedSha256: PAYLOAD_SHA });
    expect(result.resumedFrom).toBe(partial.size);
    expect(result.downloadedBytes).toBe(SIZE - partial.size);
    expect(result.sha256).toBe(PAYLOAD_SHA);
    expect(requests).toHaveLength(2);
    expect(requests[0].range).toBeNull();
    expect(requests[1].range).toBe(`bytes=${partial.size}-`);
    expect(await sha256File(dest)).toBe(PAYLOAD_SHA);
    expect(existsSync(`${dest}.part`)).toBe(false);
  });

  it("rejects and removes a download whose hash does not match", async () => {
    const dir = await tempDir();
    const { url } = await server();
    const dest = join(dir, "corrupt.bin");
    await expect(downloadWithResume(url, dest, { expectedSize: SIZE, expectedSha256: WRONG_SHA })).rejects.toBeInstanceOf(
      VerificationError
    );
    expect(existsSync(dest)).toBe(false);
    expect(existsSync(`${dest}.part`)).toBe(false);
  });

  it("restarts from scratch when the server ignores Range", async () => {
    const dir = await tempDir();
    const { url, requests } = await server({ supportRange: false });
    const dest = join(dir, "norange.bin");
    await writeFile(`${dest}.part`, randomBytes(100));
    const result = await downloadWithResume(url, dest, { expectedSize: SIZE, expectedSha256: PAYLOAD_SHA });
    expect(requests[0].range).toBe("bytes=100-");
    expect(result.resumedFrom).toBe(0);
    expect(result.downloadedBytes).toBe(SIZE);
    expect(await sha256File(dest)).toBe(PAYLOAD_SHA);
  });

  it("skips the network when the destination already verifies", async () => {
    const dir = await tempDir();
    const { url, requests } = await server();
    const dest = join(dir, "present.bin");
    await writeFile(dest, PAYLOAD);
    const result = await downloadWithResume(url, dest, { expectedSize: SIZE, expectedSha256: PAYLOAD_SHA });
    expect(result.alreadyPresent).toBe(true);
    expect(requests).toHaveLength(0);
  });

  it("replaces a corrupt existing destination", async () => {
    const dir = await tempDir();
    const { url } = await server();
    const dest = join(dir, "stale.bin");
    await writeFile(dest, randomBytes(SIZE));
    const result = await downloadWithResume(url, dest, { expectedSize: SIZE, expectedSha256: PAYLOAD_SHA });
    expect(result.alreadyPresent).toBe(false);
    expect(await sha256File(dest)).toBe(PAYLOAD_SHA);
  });

  it("surfaces HTTP errors as DownloadError", async () => {
    const dir = await tempDir();
    const { url } = await server({ status: 404 });
    await expect(
      downloadWithResume(url, join(dir, "missing.bin"), { expectedSize: SIZE, expectedSha256: PAYLOAD_SHA })
    ).rejects.toBeInstanceOf(DownloadError);
  });

  it("requires a well formed expectedSha256", async () => {
    const dir = await tempDir();
    await expect(downloadWithResume("http://127.0.0.1:1/x", join(dir, "x"), {})).rejects.toBeInstanceOf(TypeError);
  });
});
