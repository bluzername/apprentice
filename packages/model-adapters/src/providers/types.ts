/**
 * Replaceable model boundary. Only the Electron main process talks to a
 * provider; renderer code never sees these types.
 */
import type {
  AnalyzeEpisodeInput,
  DraftSkillInput,
  EpisodeAnalysis,
  ModelHealth,
  NextActionInput,
  ProposedActionResult,
  ProviderType,
  SkillDraft,
  StepVerification,
  VerifyStepInput
} from "@apprentice/schemas";

export interface VisionAgentProvider {
  health(): Promise<ModelHealth>;
  analyzeEpisode(input: AnalyzeEpisodeInput): Promise<EpisodeAnalysis>;
  draftSkill(input: DraftSkillInput): Promise<SkillDraft>;
  proposeNextAction(input: NextActionInput): Promise<ProposedActionResult>;
  verifyStep(input: VerifyStepInput): Promise<StepVerification>;
  resetSession(sessionId: string): Promise<void>;
}

export type FetchImpl = typeof fetch;

/** Injectable sleep so retry back-off is instant in tests. */
export type SleepImpl = (ms: number) => Promise<void>;

export const defaultSleep: SleepImpl = (ms) =>
  new Promise((resolveSleep) => {
    const timer = setTimeout(resolveSleep, ms);
    timer.unref?.();
  });

export class ProviderError extends Error {
  readonly provider: ProviderType;

  constructor(provider: ProviderType, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ProviderError";
    this.provider = provider;
  }
}

/** The provider cannot perform this operation at all (explicit failover, never pretend). */
export class ProviderCapabilityError extends ProviderError {
  constructor(provider: ProviderType, message: string) {
    super(provider, message);
    this.name = "ProviderCapabilityError";
  }
}

/** Endpoint unreachable, timed out, or returned an HTTP failure after retries. */
export class ProviderUnavailableError extends ProviderError {
  readonly status?: number;
  readonly attempts: number;

  constructor(provider: ProviderType, message: string, options: { cause?: unknown; status?: number; attempts?: number } = {}) {
    super(provider, message, { cause: options.cause });
    this.name = "ProviderUnavailableError";
    this.status = options.status;
    this.attempts = options.attempts ?? 1;
  }
}

/** The endpoint answered but the reply is malformed or fails schema validation. */
export class ProviderResponseError extends ProviderError {
  readonly issues: readonly string[];

  constructor(provider: ProviderType, message: string, issues: readonly string[] = []) {
    super(provider, message);
    this.name = "ProviderResponseError";
    this.issues = issues;
  }
}
