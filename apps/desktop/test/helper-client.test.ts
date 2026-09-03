import { execFile, spawn } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { HELPER_PROTOCOL_VERSION, HelperMessageSchema, type ExecutableAction, type HelperEvent } from "@apprentice/schemas";
import { beforeAll, describe, expect, it } from "vitest";
import { HELPER_SECRET_ENV, mintApprovalToken } from "../src/main/services/helper/approval-token.js";
import { FakeHelperClient } from "../src/main/services/helper/fake-helper-client.js";
import { ProcessHelperClient } from "../src/main/services/helper/helper-client.js";
import { HelperError } from "../src/main/services/helper/types.js";
import { REPO_ROOT, sleep, tempDir, waitFor } from "./helpers.js";

const execFileAsync = promisify(execFile);
const HELPER = join(REPO_ROOT, "apps", "desktop", "resources", "helper", "apprentice-helper");
const FIXTURE = join(REPO_ROOT, "native", "mac-helper", "Fixtures", "sample-observation.jsonl");

beforeAll(async () => {
  if (!existsSync(HELPER)) await execFileAsync(process.execPath, [join(REPO_ROOT, "scripts", "build-helper.mjs")], { cwd: REPO_ROOT, timeout: 600_000 });
}, 620_000);

describe("ProcessHelperClient with the real helper binary", () => {
  it("replays the fixture stream, parses every event, and answers ping", async () => {
    const dir = tempDir();
    const client = new ProcessHelperClient({ executablePath: HELPER, args: ["--fixture", FIXTURE], logPath: join(dir, "helper.log") });
    const events: HelperEvent[] = [];
    client.onEvent((event) => {
      events.push(event);
    });
    await client.start();
    expect(client.connected).toBe(true);
    const pong = await client.ping();
    expect(pong.pong).toBe(true);
    const capabilities = await client.capabilities();
    expect(capabilities.features.fixtureStream).toBe(true);
    await waitFor(() => events.some((event) => event.event === "observationState" && event.data["completed"] === true), 15_000);
    const names = new Set(events.map((event) => event.event));
    for (const expected of ["frontmostAppChanged", "windowTitleChanged", "mouseDown", "shortcut", "clipboardChanged", "secureFieldFocused", "idleChanged"]) expect(names.has(expected as HelperEvent["event"])).toBe(true);
    for (const event of events) expect(HelperMessageSchema.safeParse(event).success).toBe(true);
    expect(events.length).toBeGreaterThanOrEqual(15);
    await client.stop();
    expect(client.connected).toBe(false);
    expect(existsSync(join(dir, "helper.log"))).toBe(true);
  }, 30_000);

  it("verifies approval tokens against the per-spawn secret it was given", async () => {
    const dir = tempDir();
    const client = new ProcessHelperClient({ executablePath: HELPER, args: ["--fixture", FIXTURE], logPath: join(dir, "helper.log") });
    await client.start();
    expect(client.approvalSecret).toMatch(/^[0-9a-f]{64}$/);
    const action: ExecutableAction = { type: "wait", ms: 1 };
    const token = mintApprovalToken(client.approvalSecret, action);
    await expect(client.performAction(action, "0".repeat(64))).rejects.toMatchObject({ code: "action_rejected", message: /does not match/ });
    await expect(client.performAction({ type: "wait", ms: 2 }, token)).rejects.toMatchObject({ code: "action_rejected", message: /does not match/ });
    await expect(client.performAction(action, mintApprovalToken("ff".repeat(32), action))).rejects.toMatchObject({ code: "action_rejected" });
    // Accessibility may not be granted to the test runner, so a verified token
    // either performs the 1 ms wait or fails later on permissions; never on the token.
    const outcome = await client.performAction(action, token).then(
      (result) => (result.performed ? "performed" : "not_performed"),
      (error: unknown) => (error instanceof HelperError ? error.code : "unexpected")
    );
    expect(["performed", "permission_denied"]).toContain(outcome);
    await client.stop();
  }, 30_000);

  it("refuses performAction when started without a secret in its environment", async () => {
    const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[0] !== HELPER_SECRET_ENV && typeof entry[1] === "string"));
    const child = spawn(HELPER, [], { env, stdio: ["pipe", "pipe", "pipe"], shell: false });
    const lines: string[] = [];
    createInterface({ input: child.stdout }).on("line", (line) => lines.push(line));
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    try {
      const params = { action: { type: "wait", ms: 1 }, approvalToken: mintApprovalToken("00".repeat(32), { type: "wait", ms: 1 }) };
      child.stdin.write(`${JSON.stringify({ id: "r1", v: HELPER_PROTOCOL_VERSION, cmd: "performAction", params })}\n`);
      await waitFor(() => lines.some((line) => line.includes('"id":"r1"')), 15_000);
      const response = JSON.parse(lines.find((line) => line.includes('"id":"r1"'))!) as { ok: boolean; error?: { code: string; message: string } };
      expect(response.ok).toBe(false);
      expect(response.error?.code).toBe("action_rejected");
      expect(response.error?.message).toMatch(/without an approval secret/);
    } finally {
      child.stdin.end();
      const killer = setTimeout(() => child.kill("SIGKILL"), 5000);
      await exited;
      clearTimeout(killer);
    }
  }, 30_000);
});

describe("ProcessHelperClient restart logic", () => {
  it("gives up after maxRestarts with exponential backoff when the process keeps crashing", async () => {
    const dir = tempDir();
    const script = join(dir, "crash.cjs");
    writeFileSync(script, "process.exit(3);\n");
    const client = new ProcessHelperClient({ executablePath: process.execPath, args: [script], logPath: join(dir, "helper.log"), restartBackoffMs: 5, maxRestarts: 3, readyTimeoutMs: 5000 });
    const states: string[] = [];
    client.onState((snapshot) => states.push(snapshot.state));
    await expect(client.start()).rejects.toThrow();
    expect(client.restarts).toBe(3);
    expect(client.snapshot().state).toBe("failed");
    expect(states.filter((state) => state === "restarting").length).toBe(3);
  }, 15_000);

  it("restarts a crashed helper and resumes serving requests", async () => {
    const dir = tempDir();
    const script = join(dir, "flaky.cjs");
    writeFileSync(
      script,
      [
        'const readline = require("node:readline");',
        'const send = (obj) => process.stdout.write(JSON.stringify(obj) + "\\n");',
        'send({ type: "event", v: "1.0", event: "helperReady", ts: Date.now(), seq: 0, data: {} });',
        "const rl = readline.createInterface({ input: process.stdin });",
        'rl.on("line", (line) => {',
        "  const req = JSON.parse(line);",
        '  if (req.cmd === "ping") send({ type: "response", id: req.id, v: "1.0", ok: true, result: { pong: true, ts: Date.now(), stopped: false } });',
        '  else if (req.cmd === "capabilities") process.exit(1);',
        '  else if (req.cmd === "shutdown") { send({ type: "response", id: req.id, v: "1.0", ok: true, result: { shuttingDown: true } }); process.exit(0); }',
        '  else send({ type: "response", id: req.id, v: "1.0", ok: false, error: { code: "unknown_command", message: "nope" } });',
        "});",
        'rl.on("close", () => process.exit(0));'
      ].join("\n")
    );
    chmodSync(script, 0o644);
    const client = new ProcessHelperClient({ executablePath: process.execPath, args: [script], logPath: join(dir, "helper.log"), restartBackoffMs: 5, maxRestarts: 5, readyTimeoutMs: 5000 });
    await client.start();
    expect((await client.ping()).pong).toBe(true);
    await expect(client.capabilities()).rejects.toThrow();
    await waitFor(() => client.connected, 5000);
    expect(client.restarts).toBe(1);
    expect((await client.ping()).pong).toBe(true);
    await expect(client.request("frontmostContext")).rejects.toThrow(/nope/);
    await client.stop();
  }, 15_000);
});

describe("FakeHelperClient", () => {
  it("replays a fixture file instantly and records requests", async () => {
    const fake = new FakeHelperClient({ fixtureDelayScale: 0 });
    const events: HelperEvent[] = [];
    fake.onEvent((event) => events.push(event));
    await fake.start();
    await fake.startObservation({ fixturePath: FIXTURE });
    await sleep(20);
    const lines = readFileSync(FIXTURE, "utf8").split("\n").filter((line) => line.trim().length > 0 && !line.startsWith("#")).length;
    expect(events.filter((event) => event.event !== "helperReady" || event.seq > 1).length).toBeGreaterThanOrEqual(lines);
    expect(fake.requests.some((request) => request.cmd === "startObservation")).toBe(true);
    await fake.stopObservation();
  });

  it("refuses actions without a valid approval token and while emergency-stopped", async () => {
    const fake = new FakeHelperClient();
    await fake.start();
    const click: ExecutableAction = { type: "click", x: 1, y: 1, button: "left" };
    const wait: ExecutableAction = { type: "wait", ms: 100 };
    await expect(fake.performAction(click, "short")).rejects.toThrow(/approval token/);
    await expect(fake.performAction(click, "0123456789abcdef")).rejects.toThrow(/does not match/);
    await expect(fake.performAction(click, mintApprovalToken(fake.approvalSecret!, click))).resolves.toEqual({ performed: true, durationMs: 1 });
    await fake.emergencyStop();
    await expect(fake.performAction(wait, mintApprovalToken(fake.approvalSecret!, wait))).rejects.toThrow(/emergency/);
    await fake.emergencyStop(true);
    expect(fake.emergencyStopped).toBe(false);
    expect(fake.actions).toHaveLength(1);
  });

  it("uses scripted responses when provided", async () => {
    const fake = new FakeHelperClient({ responses: { permissionStatus: () => ({ accessibility: "denied", screenRecording: "granted" }) } });
    await fake.start();
    expect((await fake.permissionStatus()).accessibility).toBe("denied");
  });

  it("records activateApp calls and honours a scripted activation result", async () => {
    const fake = new FakeHelperClient();
    await fake.start();
    await expect(fake.activateApp("com.apple.finder")).resolves.toEqual({ activated: true, pid: 4242 });
    await expect(fake.activateApp("  ")).rejects.toMatchObject({ code: "invalid_request" });
    expect(fake.activations).toEqual(["com.apple.finder"]);
    const scripted = new FakeHelperClient({ activate: (bundleId) => ({ activated: bundleId === "com.apple.Preview" }) });
    await scripted.start();
    await expect(scripted.activateApp("com.apple.Preview")).resolves.toEqual({ activated: true });
    await expect(scripted.activateApp("com.missing.App")).resolves.toEqual({ activated: false });
    expect(scripted.activations).toEqual(["com.apple.Preview", "com.missing.App"]);
    expect(scripted.requests.filter((request) => request.cmd === "activateApp")).toHaveLength(2);
  });
});
