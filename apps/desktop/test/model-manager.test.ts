import { describe, expect, it } from "vitest";
import { systemClock } from "../src/main/services/clock.js";
import { createRecordingEmitter } from "../src/main/services/events.js";
import { HardwareService } from "../src/main/services/hardware.js";
import { nodePngResizer } from "../src/main/services/images/png-resize.js";
import { toImageResizer } from "../src/main/services/images/png-resize.js";
import { silentLogger } from "../src/main/services/logger.js";
import { MODEL_MANIFEST } from "../src/main/services/model/manifest.js";
import { ModelManager } from "../src/main/services/model/model-manager.js";
import { RuntimeManager } from "../src/main/services/model/runtime-manager.js";
import { makeContext } from "./helpers.js";

function setup() {
  const context = makeContext();
  const recorder = createRecordingEmitter();
  const runtime = new RuntimeManager({ paths: context.paths, manifest: MODEL_MANIFEST, clock: systemClock, logger: silentLogger });
  const manager = new ModelManager({
    settings: context.settings,
    secrets: context.secrets,
    runtime,
    manifest: MODEL_MANIFEST,
    hardware: new HardwareService(context.paths.root),
    metrics: context.metrics,
    analytics: context.analytics,
    clock: systemClock,
    logger: silentLogger,
    emit: recorder.emit,
    power: { onBattery: () => false, thermalState: () => "nominal", idleSeconds: () => 0 },
    resizer: toImageResizer(nodePngResizer),
    healthIntervalMs: 60_000
  });
  return { context, recorder, runtime, manager };
}

describe("model manager", () => {
  it("emits health and status while running", async () => {
    const { manager, recorder } = setup();
    manager.start();
    await manager.checkHealth();
    expect(recorder.of("event:modelHealth").length).toBeGreaterThanOrEqual(1);
    expect(recorder.of("event:modelHealth")[0]?.ok).toBe(true);
    manager.stop();
  });

  it("emits nothing after stop(), even when a late health check or runtime change arrives", async () => {
    const { manager, recorder, runtime } = setup();
    manager.start();
    await manager.checkHealth();
    manager.stop();
    const before = recorder.events.length;
    await manager.checkHealth();
    await runtime.stop();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(manager.isStopped).toBe(true);
    expect(recorder.events.length).toBe(before);
  });
});
