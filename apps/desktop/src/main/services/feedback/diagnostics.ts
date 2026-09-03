import { redactRunTraceForExport } from "@apprentice/core";
import type { HardwareInfo, ModelStatus, Run, RunStep } from "@apprentice/schemas";
import { memoryBucket } from "../hardware.js";

export interface DiagnosticsInput {
  readonly appVersion: string;
  readonly hardware: HardwareInfo;
  readonly model: Pick<ModelStatus, "providerType" | "model">;
  readonly perf: Readonly<Record<string, number>>;
  readonly helperRestarts: number;
}

/** Numbers and enums only: app version, macOS major, chip family, memory bucket, provider/model, perf snapshot. */
export function buildDiagnostics(input: DiagnosticsInput): Record<string, unknown> {
  return {
    appVersion: input.appVersion,
    macosMajor: input.hardware.macosMajor,
    chipFamily: input.hardware.chipFamily,
    memoryBucket: memoryBucket(input.hardware.memoryGb),
    provider: input.model.providerType,
    model: input.model.model ?? "",
    helperRestarts: input.helperRestarts,
    perf: Object.fromEntries(Object.entries(input.perf).map(([key, value]) => [key, Math.round(value * 100) / 100]))
  };
}

export interface RunTraceFile {
  readonly json: string;
  readonly redactedFields: readonly string[];
}

export function buildRunTraceFile(run: Run, steps: readonly RunStep[]): RunTraceFile {
  const redacted = redactRunTraceForExport(run, steps);
  return { json: JSON.stringify({ run: redacted.run, steps: redacted.steps }, null, 2), redactedFields: redacted.redactedFields };
}

const ELLIPSIS = "...";

/** Truncates to at most `max` characters, ellipsis included, so the IPC schema limit always holds. */
export function preview(text: string, max = 4000): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - ELLIPSIS.length))}${ELLIPSIS}`;
}
