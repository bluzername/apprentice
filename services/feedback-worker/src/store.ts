import type { RemoteFeedbackPayload, TelemetryBatch } from "@apprentice/schemas";
import { MAX_BOUND_PARAMS } from "./meta.js";

export interface SubmissionRow {
  readonly id: string;
  readonly kind: "feedback" | "telemetry";
  readonly installationId: string;
  readonly participantCode: string | null;
  readonly appVersion: string;
  readonly macosMajor: number | null;
  readonly chipFamily: string | null;
  readonly memoryBucket: string | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly modelVersion: string | null;
  readonly receivedAt: number;
  readonly payloadBytes: number;
  readonly payloadHash: string;
}

interface SubmissionMeta {
  readonly id: string;
  readonly receivedAt: number;
  readonly payloadBytes: number;
  readonly payloadHash: string;
}

export const feedbackSubmissionRow = (payload: RemoteFeedbackPayload, meta: SubmissionMeta): SubmissionRow => ({
  ...meta,
  kind: "feedback",
  installationId: payload.installationId,
  participantCode: payload.participantCode ?? null,
  appVersion: payload.appVersion,
  macosMajor: payload.macosMajor,
  chipFamily: payload.chipFamily,
  memoryBucket: payload.memoryBucket,
  provider: payload.provider,
  model: payload.model ?? null,
  modelVersion: payload.modelVersion ?? null
});

export const telemetrySubmissionRow = (batch: TelemetryBatch, meta: SubmissionMeta): SubmissionRow => ({
  ...meta,
  kind: "telemetry",
  installationId: batch.installationId,
  participantCode: null,
  appVersion: batch.appVersion,
  macosMajor: null,
  chipFamily: null,
  memoryBucket: null,
  provider: null,
  model: null,
  modelVersion: null
});

type EventInput = RemoteFeedbackPayload["events"][number];
type FeedbackInput = RemoteFeedbackPayload["feedback"][number];

const chunk = <T>(items: readonly T[], size: number): T[][] =>
  items.length === 0 ? [] : [items.slice(0, size), ...chunk(items.slice(size), size)];

const multiRowInsert = (
  db: D1Database,
  table: string,
  columns: readonly string[],
  rows: readonly (readonly unknown[])[]
): D1PreparedStatement[] => {
  const rowsPerStatement = Math.max(1, Math.floor(MAX_BOUND_PARAMS / columns.length));
  const placeholders = `(${columns.map(() => "?").join(", ")})`;
  return chunk(rows, rowsPerStatement).map((group) =>
    db
      .prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES ${group.map(() => placeholders).join(", ")}`)
      .bind(...group.flat())
  );
};

const submissionInsert = (db: D1Database, row: SubmissionRow): D1PreparedStatement =>
  db
    .prepare(
      `INSERT INTO submissions (id, kind, installation_id, participant_code, app_version, macos_major, chip_family,
         memory_bucket, provider, model, model_version, received_at, payload_bytes, payload_hash)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`
    )
    .bind(
      row.id,
      row.kind,
      row.installationId,
      row.participantCode,
      row.appVersion,
      row.macosMajor,
      row.chipFamily,
      row.memoryBucket,
      row.provider,
      row.model,
      row.modelVersion,
      row.receivedAt,
      row.payloadBytes,
      row.payloadHash
    );

const eventInserts = (db: D1Database, submissionId: string, events: readonly EventInput[]): D1PreparedStatement[] =>
  multiRowInsert(
    db,
    "events",
    ["submission_id", "name", "ts", "risk_class", "provider", "counts_json"],
    events.map((e) => [submissionId, e.name, e.ts, e.riskClass ?? null, e.provider ?? null, JSON.stringify(e.counts)])
  );

const feedbackInserts = (db: D1Database, submissionId: string, items: readonly FeedbackInput[]): D1PreparedStatement[] =>
  multiRowInsert(
    db,
    "feedback_items",
    ["submission_id", "context_type", "answers_json", "comment", "created_at"],
    items.map((f) => [submissionId, f.contextType, JSON.stringify(f.answers), f.comment ?? null, f.createdAt])
  );

export const findSubmissionByHash = async (db: D1Database, payloadHash: string): Promise<{ id: string } | null> =>
  db.prepare("SELECT id FROM submissions WHERE payload_hash = ?1").bind(payloadHash).first<{ id: string }>();

/** Stores a submission with its events and feedback items in a single D1 batch (atomic). */
export const storeSubmission = async (
  db: D1Database,
  row: SubmissionRow,
  events: readonly EventInput[],
  feedback: readonly FeedbackInput[]
): Promise<void> => {
  await db.batch([submissionInsert(db, row), ...eventInserts(db, row.id, events), ...feedbackInserts(db, row.id, feedback)]);
};
