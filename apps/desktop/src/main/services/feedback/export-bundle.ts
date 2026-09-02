import { createSafeZip, findForbiddenKeys, type ZipEntry } from "@apprentice/core";
import { FEEDBACK_BUNDLE_EXTENSION, FeedbackBundleManifestSchema, PRODUCT_ID, ProductEventSchema, type Feedback, type ProductEvent } from "@apprentice/schemas";
import { join } from "node:path";

export interface BundleInput {
  readonly exportsDir: string;
  readonly installationId: string;
  readonly participantCode?: string;
  readonly appVersion: string;
  readonly createdAt: number;
  readonly events: readonly ProductEvent[];
  readonly feedback: readonly Feedback[];
  readonly diagnostics: Record<string, unknown>;
  readonly runTraceJson?: string;
  readonly screenshots: ReadonlyArray<{ id: string; png: Buffer }>;
}

export interface BundleResult {
  readonly path: string;
  readonly fileCount: number;
  readonly includesScreenshots: boolean;
  readonly files: readonly string[];
}

/** Drops any prop whose key is forbidden, then re-validates the event. */
export function sanitizeProductEvent(event: ProductEvent): ProductEvent {
  const forbidden = new Set(findForbiddenKeys(event.props).map((path) => path.split(".")[0] ?? path));
  const props = Object.fromEntries(Object.entries(event.props).filter(([key]) => !forbidden.has(key)));
  return ProductEventSchema.parse({ ...event, props });
}

export function bundleFileName(createdAt: number): string {
  return `${new Date(createdAt).toISOString().replace(/[:.]/g, "-")}${FEEDBACK_BUNDLE_EXTENSION}`;
}

/**
 * Writes the sanitized feedback bundle with exactly the documented layout:
 * manifest.json, product-events.jsonl, feedback.json, diagnostics.json,
 * optional run-trace.json, and screenshots/<id>.png only for selected ids.
 */
export async function writeFeedbackBundle(input: BundleInput): Promise<BundleResult> {
  const files: string[] = ["manifest.json", "product-events.jsonl", "feedback.json", "diagnostics.json"];
  if (input.runTraceJson !== undefined) files.push("run-trace.json");
  for (const shot of input.screenshots) files.push(`screenshots/${shot.id}.png`);
  const manifest = FeedbackBundleManifestSchema.parse({
    bundleVersion: 1,
    productId: PRODUCT_ID,
    installationId: input.installationId,
    ...(input.participantCode ? { participantCode: input.participantCode } : {}),
    createdAt: input.createdAt,
    appVersion: input.appVersion,
    files,
    includesScreenshots: input.screenshots.length > 0,
    screenshotCount: input.screenshots.length
  });
  const events = input.events.map(sanitizeProductEvent);
  const eventsJsonl = events.map((event) => JSON.stringify(event)).join("\n");
  const entries: ZipEntry[] = [
    { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2)) },
    { name: "product-events.jsonl", data: Buffer.from(eventsJsonl.length > 0 ? `${eventsJsonl}\n` : "") },
    { name: "feedback.json", data: Buffer.from(JSON.stringify(input.feedback, null, 2)) },
    { name: "diagnostics.json", data: Buffer.from(JSON.stringify(input.diagnostics, null, 2)) }
  ];
  if (input.runTraceJson !== undefined) entries.push({ name: "run-trace.json", data: Buffer.from(input.runTraceJson) });
  for (const shot of input.screenshots) entries.push({ name: `screenshots/${shot.id}.png`, data: shot.png });
  const path = join(input.exportsDir, bundleFileName(input.createdAt));
  const written = await createSafeZip(entries, path);
  return { path, fileCount: written.fileCount, includesScreenshots: input.screenshots.length > 0, files };
}
