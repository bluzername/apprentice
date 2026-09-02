import { ProviderCapabilityError, type VisionAgentProvider } from "@apprentice/model-adapters";
import type { AnalyzeEpisodeInput, DraftSkillInput, EpisodeAnalysis, ModelHealth, NextActionInput, ProposedActionResult, SkillDraft, StepVerification, VerifyStepInput } from "@apprentice/schemas";

/**
 * Explicit fail-over for analysis-shaped calls when only a GUI action policy
 * (UI-Mate) is configured. Drafting returns the deterministic draft unchanged;
 * nothing is fabricated.
 */
export class DeterministicAnalysisProvider implements VisionAgentProvider {
  constructor(private readonly now: () => number = Date.now) {}

  health(): Promise<ModelHealth> {
    return Promise.resolve({
      ok: true,
      provider: "mock",
      model: "deterministic",
      endpoint: "memory://deterministic",
      latencyMs: 0,
      message: "deterministic fallback: no analysis endpoint configured",
      capabilities: { vision: false, actionPolicy: false, structuredOutput: true },
      checkedAt: this.now()
    });
  }

  analyzeEpisode(_input: AnalyzeEpisodeInput): Promise<EpisodeAnalysis> {
    return Promise.reject(new ProviderCapabilityError("uimate", "Episode analysis needs a generic multimodal endpoint; none is configured"));
  }

  draftSkill(input: DraftSkillInput): Promise<SkillDraft> {
    return Promise.resolve({ ...input.deterministicDraft, origin: "deterministic" });
  }

  proposeNextAction(_input: NextActionInput): Promise<ProposedActionResult> {
    return Promise.reject(new ProviderCapabilityError("uimate", "The deterministic fallback cannot propose actions"));
  }

  verifyStep(_input: VerifyStepInput): Promise<StepVerification> {
    return Promise.resolve({ passed: false, subtaskComplete: false, method: "none", evidence: "No analysis provider configured for supporting verification", confidence: 0 });
  }

  resetSession(_sessionId: string): Promise<void> {
    return Promise.resolve();
  }
}
