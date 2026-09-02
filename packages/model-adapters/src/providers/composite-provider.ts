/**
 * Routes `proposeNextAction` to a GUI action policy (UI-Mate) and every
 * analysis-shaped call to a generic multimodal provider.
 */
import type {
  AnalyzeEpisodeInput,
  DraftSkillInput,
  EpisodeAnalysis,
  ModelHealth,
  NextActionInput,
  ProposedActionResult,
  SkillDraft,
  StepVerification,
  VerifyStepInput
} from "@apprentice/schemas";
import type { VisionAgentProvider } from "./types.js";

export interface CompositeProviderOptions {
  readonly action: VisionAgentProvider;
  readonly analysis: VisionAgentProvider;
}

export class CompositeVisionAgentProvider implements VisionAgentProvider {
  private readonly action: VisionAgentProvider;
  private readonly analysis: VisionAgentProvider;

  constructor(options: CompositeProviderOptions) {
    this.action = options.action;
    this.analysis = options.analysis;
  }

  /** Health of the action policy; the analysis provider's health is folded into the message. */
  async health(): Promise<ModelHealth> {
    const [action, analysis] = await Promise.all([this.action.health(), this.analysis.health()]);
    const message = `action: ${action.message ?? (action.ok ? "ok" : "unavailable")} | analysis: ${analysis.message ?? (analysis.ok ? "ok" : "unavailable")}`;
    return {
      ...action,
      ok: action.ok && analysis.ok,
      message: message.slice(0, 500),
      capabilities: {
        vision: action.capabilities.vision || analysis.capabilities.vision,
        actionPolicy: action.capabilities.actionPolicy,
        structuredOutput: analysis.capabilities.structuredOutput
      }
    };
  }

  analyzeEpisode(input: AnalyzeEpisodeInput): Promise<EpisodeAnalysis> {
    return this.analysis.analyzeEpisode(input);
  }

  draftSkill(input: DraftSkillInput): Promise<SkillDraft> {
    return this.analysis.draftSkill(input);
  }

  proposeNextAction(input: NextActionInput): Promise<ProposedActionResult> {
    return this.action.proposeNextAction(input);
  }

  verifyStep(input: VerifyStepInput): Promise<StepVerification> {
    return this.analysis.verifyStep(input);
  }

  async resetSession(sessionId: string): Promise<void> {
    await Promise.all([this.action.resetSession(sessionId), this.analysis.resetSession(sessionId)]);
  }
}
