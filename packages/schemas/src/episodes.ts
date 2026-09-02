import { z } from "zod";
import { DurationMsSchema, IdSchema, TimestampMsSchema } from "./common.js";

export const EpisodeBoundaryReasonSchema = z.enum([
  "teach_marker",
  "idle_gap",
  "outcome_event",
  "calendar_boundary",
  "context_shift",
  "user_correction",
  "session_edge"
]);
export type EpisodeBoundaryReason = z.infer<typeof EpisodeBoundaryReasonSchema>;

export const EpisodePrivacyStatusSchema = z.enum(["clean", "contains_gaps", "contains_sensitive"]);
export const EpisodeAnalysisStatusSchema = z.enum(["none", "queued", "analyzed", "failed"]);

export const EpisodeSchema = z.object({
  id: IdSchema,
  sessionId: IdSchema,
  startTs: TimestampMsSchema,
  endTs: TimestampMsSchema,
  eventIds: z.array(IdSchema),
  boundary: z.enum(["explicit", "inferred"]),
  boundaryReasons: z.array(EpisodeBoundaryReasonSchema),
  apps: z.array(z.string().max(256)),
  domains: z.array(z.string().max(253)),
  /** Normalized action tokens in order (see core/normalize). */
  actionTokens: z.array(z.string().max(512)),
  meaningfulActionCount: z.number().int().nonnegative(),
  triggerHypothesis: z.string().max(512).optional(),
  outcomeHypothesis: z.string().max(512).optional(),
  activeDurationMs: DurationMsSchema,
  privacyStatus: EpisodePrivacyStatusSchema,
  analysisStatus: EpisodeAnalysisStatusSchema,
  /** Set when the episode is dominated by consumption behaviour (news, social). */
  consumptionScore: z.number().min(0).max(1).default(0)
});
export type Episode = z.infer<typeof EpisodeSchema>;
