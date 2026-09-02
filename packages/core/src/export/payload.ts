import {
  FEEDBACK_PAYLOAD_VERSION,
  FORBIDDEN_REMOTE_KEYS,
  RemoteFeedbackPayloadSchema,
  type Feedback,
  type PerformanceMetrics,
  type ProductEvent,
  type RemoteFeedbackPayload
} from "@apprentice/schemas";
import { findForbiddenKeys } from "./forbidden-keys.js";

export interface RemotePayloadInput {
  readonly feedback: readonly Feedback[];
  readonly events: readonly ProductEvent[];
  readonly installationId: string;
  readonly participantCode?: string;
  readonly appVersion: string;
  readonly macosMajor: number;
  readonly chipFamily: RemoteFeedbackPayload["chipFamily"];
  readonly memoryBucket: RemoteFeedbackPayload["memoryBucket"];
  readonly provider: string;
  readonly model?: string;
  readonly modelVersion?: string;
  readonly performance?: PerformanceMetrics;
}

export interface RemotePayloadResult {
  readonly payload: RemoteFeedbackPayload;
  readonly removedFields: readonly string[];
}

/** The event name is a schema-enforced enum, not free text, so it is exempt from the key scan. */
const SCAN_IGNORE_PATHS: readonly string[] = ["events[*].name"];
const FORBIDDEN: ReadonlySet<string> = new Set(FORBIDDEN_REMOTE_KEYS.map((key) => key.toLowerCase()));

function numericCounts(event: ProductEvent, index: number, removed: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [key, value] of Object.entries(event.props)) {
    if (typeof value === "number" && Number.isFinite(value) && !FORBIDDEN.has(key.toLowerCase())) {
      counts[key] = value;
    } else {
      removed.push(`events[${index}].props.${key}`);
    }
  }
  return counts;
}

/**
 * Builds the strict remote payload: numeric counts only, structured answers,
 * and comments only after the warning was shown. Throws if any forbidden key survives.
 */
export function buildRemotePayload(input: RemotePayloadInput): RemotePayloadResult {
  const removedFields: string[] = [];
  const events = input.events.map((event, index) => ({
    name: event.name,
    ts: event.ts,
    counts: numericCounts(event, index, removedFields),
    ...(event.riskClass !== undefined ? { riskClass: event.riskClass } : {})
  }));
  const feedback = input.feedback.map((item, index) => {
    const includeComment = item.comment !== undefined && item.comment.length > 0 && item.consent.commentWarningShown;
    if (item.comment !== undefined && item.comment.length > 0 && !includeComment) removedFields.push(`feedback[${index}].comment`);
    return {
      contextType: item.contextType,
      answers: item.answers,
      ...(includeComment ? { comment: item.comment } : {}),
      createdAt: item.createdAt
    };
  });
  const candidate = {
    schemaVersion: FEEDBACK_PAYLOAD_VERSION,
    installationId: input.installationId,
    ...(input.participantCode !== undefined ? { participantCode: input.participantCode } : {}),
    appVersion: input.appVersion,
    macosMajor: input.macosMajor,
    chipFamily: input.chipFamily,
    memoryBucket: input.memoryBucket,
    provider: input.provider,
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.modelVersion !== undefined ? { modelVersion: input.modelVersion } : {}),
    events,
    feedback,
    ...(input.performance !== undefined ? { performance: input.performance } : {})
  };
  const parsed = RemoteFeedbackPayloadSchema.safeParse(candidate);
  if (!parsed.success) throw new Error(`Remote payload failed validation: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  const survivors = findForbiddenKeys(parsed.data, FORBIDDEN_REMOTE_KEYS, { ignorePaths: SCAN_IGNORE_PATHS });
  if (survivors.length > 0) throw new Error(`Remote payload contains forbidden keys: ${survivors.join(", ")}`);
  return { payload: parsed.data, removedFields };
}
