import { DAY_MS, RETENTION_DAYS, SUMMARY_COMMENT_LIMIT } from "./meta.js";

export interface SummaryTotals {
  readonly submissions: number;
  readonly installations: number;
  readonly feedbackItems: number;
  readonly events: number;
}

export interface SummaryComment {
  readonly contextType: string;
  readonly createdAt: number;
  readonly comment: string;
}

export interface Summary {
  readonly generatedAt: number;
  readonly totals: SummaryTotals;
  readonly funnel: Record<string, number>;
  readonly candidateRelevanceRate: number | null;
  readonly candidateFeedbackCount: number;
  readonly delegationIntent: Record<string, number>;
  readonly runOutcome: Record<string, number>;
  readonly meanTrustRating: number | null;
  readonly medianTimeSavedMinutes: number | null;
  readonly failureCategories: Record<string, number>;
  readonly retention: { readonly cohort: number; readonly byDay: Record<string, number> };
  readonly comments: readonly SummaryComment[];
}

type CountRow = { key: string | null; n: number };

const TOTALS_SQL = `SELECT
  (SELECT COUNT(*) FROM submissions) AS submissions,
  (SELECT COUNT(DISTINCT installation_id) FROM submissions) AS installations,
  (SELECT COUNT(*) FROM feedback_items) AS feedbackItems,
  (SELECT COUNT(*) FROM events) AS events`;

const FUNNEL_SQL = "SELECT name AS key, COUNT(*) AS n FROM events GROUP BY name ORDER BY name";

const RELEVANCE_SQL = `SELECT
  SUM(CASE WHEN json_extract(answers_json, '$.relevant') = 1 THEN 1 ELSE 0 END) AS relevant,
  COUNT(*) AS total
  FROM feedback_items WHERE context_type = 'candidate'`;

const DELEGATION_SQL = `SELECT json_extract(answers_json, '$.wouldDelegate') AS key, COUNT(*) AS n
  FROM feedback_items WHERE context_type = 'candidate' GROUP BY key ORDER BY key`;

const RUN_OUTCOME_SQL = `SELECT json_extract(answers_json, '$.outcomeAchieved') AS key, COUNT(*) AS n
  FROM feedback_items WHERE context_type = 'run' GROUP BY key ORDER BY key`;

const TRUST_SQL = `SELECT AVG(json_extract(answers_json, '$.trustRating')) AS mean
  FROM feedback_items WHERE context_type = 'run'`;

const TIME_SAVED_SQL = `SELECT json_extract(answers_json, '$.estimatedTimeSavedMinutes') AS v
  FROM feedback_items WHERE context_type = 'run' AND v IS NOT NULL ORDER BY v LIMIT 100000`;

const FAILURE_SQL = `SELECT json_extract(answers_json, '$.failureCategory') AS key, COUNT(*) AS n
  FROM feedback_items WHERE context_type = 'run' GROUP BY key ORDER BY key`;

/**
 * Retention anchor per installation is its first observed activity: the earlier of the first
 * submission and the earliest event timestamp (events are batched, so they may predate upload).
 */
const RETENTION_SQL = `WITH anchors AS (
    SELECT s.installation_id AS installation_id,
           MIN(MIN(s.received_at), COALESCE(MIN(e.ts), MIN(s.received_at))) AS anchor
    FROM submissions s LEFT JOIN events e ON e.submission_id = s.id
    GROUP BY s.installation_id
  ), days AS (
    SELECT s.installation_id AS installation_id, CAST((e.ts - a.anchor) / ${DAY_MS} AS INTEGER) AS day
    FROM events e
    JOIN submissions s ON s.id = e.submission_id
    JOIN anchors a ON a.installation_id = s.installation_id
  )
  SELECT CAST(day AS TEXT) AS key, COUNT(DISTINCT installation_id) AS n
  FROM days WHERE day IN (${RETENTION_DAYS.join(", ")}) GROUP BY day`;

const COMMENTS_SQL = `SELECT context_type AS contextType, created_at AS createdAt, comment
  FROM feedback_items WHERE comment IS NOT NULL AND comment <> ''
  ORDER BY created_at DESC, id DESC LIMIT ${SUMMARY_COMMENT_LIMIT}`;

const toRecord = (rows: readonly CountRow[]): Record<string, number> =>
  Object.fromEntries(rows.map((r) => [r.key ?? "unknown", Number(r.n)]));

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] ?? 0;
  const lower = sorted[mid - 1] ?? upper;
  return sorted.length % 2 === 0 ? (lower + upper) / 2 : upper;
};

const rowsOf = <T>(result: D1Result<unknown> | undefined): T[] => (result?.results ?? []) as T[];
const firstOf = <T>(result: D1Result<unknown> | undefined): T | undefined => rowsOf<T>(result)[0];

export const buildSummary = async (db: D1Database, now: number): Promise<Summary> => {
  const [totals, funnel, relevance, delegation, runOutcome, trust, timeSaved, failure, retention, comments] =
    await db.batch([
      db.prepare(TOTALS_SQL),
      db.prepare(FUNNEL_SQL),
      db.prepare(RELEVANCE_SQL),
      db.prepare(DELEGATION_SQL),
      db.prepare(RUN_OUTCOME_SQL),
      db.prepare(TRUST_SQL),
      db.prepare(TIME_SAVED_SQL),
      db.prepare(FAILURE_SQL),
      db.prepare(RETENTION_SQL),
      db.prepare(COMMENTS_SQL)
    ]);

  const totalsRow = firstOf<SummaryTotals>(totals) ?? { submissions: 0, installations: 0, feedbackItems: 0, events: 0 };
  const relevanceRow = firstOf<{ relevant: number | null; total: number }>(relevance) ?? { relevant: 0, total: 0 };
  const trustRow = firstOf<{ mean: number | null }>(trust) ?? { mean: null };
  const timeSavedValues = rowsOf<{ v: number }>(timeSaved).map((r) => Number(r.v));
  const retentionByDay = Object.fromEntries(RETENTION_DAYS.map((d) => [String(d), 0]));

  return {
    generatedAt: now,
    totals: {
      submissions: Number(totalsRow.submissions),
      installations: Number(totalsRow.installations),
      feedbackItems: Number(totalsRow.feedbackItems),
      events: Number(totalsRow.events)
    },
    funnel: toRecord(rowsOf<CountRow>(funnel)),
    candidateRelevanceRate: relevanceRow.total > 0 ? Number(relevanceRow.relevant ?? 0) / Number(relevanceRow.total) : null,
    candidateFeedbackCount: Number(relevanceRow.total),
    delegationIntent: toRecord(rowsOf<CountRow>(delegation)),
    runOutcome: toRecord(rowsOf<CountRow>(runOutcome)),
    meanTrustRating: trustRow.mean === null ? null : Number(trustRow.mean),
    medianTimeSavedMinutes: median(timeSavedValues),
    failureCategories: toRecord(rowsOf<CountRow>(failure)),
    retention: {
      cohort: Number(totalsRow.installations),
      byDay: { ...retentionByDay, ...toRecord(rowsOf<CountRow>(retention)) }
    },
    comments: rowsOf<SummaryComment>(comments)
  };
};
