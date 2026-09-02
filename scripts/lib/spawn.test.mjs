import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LOOPBACK_HOST, findFreePort, isProcessAlive, runLogged, spawnLogged, waitForHttpOk, which } from "./spawn.mjs";

describe("spawn helpers", () => {
  const cleanups = [];
  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()();
    }
  });

  it("findFreePort returns a port that binds on 127.0.0.1", async () => {
    const port = await findFreePort();
    expect(Number.isInteger(port)).toBe(true);
    expect(port).toBeGreaterThan(1023);
    expect(port).toBeLessThanOrEqual(65535);
    expect(LOOPBACK_HOST).toBe("127.0.0.1");
    const server = createNetServer();
    await new Promise((resolve, reject) => {
      server.on("error", reject);
      server.listen(port, LOOPBACK_HOST, resolve);
    });
    expect(server.address().address).toBe("127.0.0.1");
    await new Promise((resolve) => server.close(resolve));
  });

  it("spawnLogged passes arguments verbatim (no shell) and logs stdout and stderr", async () => {
    const dir = await mkdtemp(join(tmpdir(), "apprentice-spawn-"));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const logPath = join(dir, "nested", "child.log");
    const tricky = "a b; echo $HOME | cat && rm -rf / `id` \"quoted\"";
    const { code } = await runLogged(
      process.execPath,
      ["-e", "console.log(JSON.stringify(process.argv.slice(1))); console.error('to-stderr');", tricky, "second"],
      { logPath }
    );
    expect(code).toBe(0);
    const log = await readFile(logPath, "utf8");
    expect(log).toContain(JSON.stringify([tricky, "second"]));
    expect(log).toContain("to-stderr");
  });

  it("spawnLogged rejects non-array arguments and missing logPath", async () => {
    await expect(spawnLogged(process.execPath, "-e 1", { logPath: "/dev/null" })).rejects.toBeInstanceOf(TypeError);
    await expect(spawnLogged(process.execPath, ["-e", 1], { logPath: "/dev/null" })).rejects.toBeInstanceOf(TypeError);
    await expect(spawnLogged(process.execPath, ["-e", "1"], {})).rejects.toBeInstanceOf(TypeError);
  });

  it("waitForHttpOk resolves once the endpoint returns 200 and times out otherwise", async () => {
    let hits = 0;
    const server = createHttpServer((_req, res) => {
      hits += 1;
      res.writeHead(hits < 3 ? 503 : 200);
      res.end();
    });
    await new Promise((resolve) => server.listen(0, LOOPBACK_HOST, resolve));
    cleanups.push(() => new Promise((resolve) => server.close(resolve)));
    const url = `http://127.0.0.1:${server.address().port}/health`;
    await expect(waitForHttpOk(url, 5000, { intervalMs: 20 })).resolves.toBe(true);
    expect(hits).toBe(3);

    hits = -1000;
    await expect(waitForHttpOk(url, 200, { intervalMs: 20 })).rejects.toThrow(/Timed out/);
    await expect(waitForHttpOk(url, 5000, { intervalMs: 20, shouldAbort: () => "child exited" })).rejects.toThrow(/child exited/);
  });

  it("isProcessAlive and which behave", async () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    const child = await spawnLogged(process.execPath, ["-e", "0"], { logPath: "/dev/null" });
    await new Promise((resolve) => child.on("exit", resolve));
    expect(isProcessAlive(child.pid)).toBe(false);
    expect(await which("definitely-not-a-binary-apprentice")).toBeNull();
    expect(await which("tar")).toMatch(/tar$/);
  });
});
