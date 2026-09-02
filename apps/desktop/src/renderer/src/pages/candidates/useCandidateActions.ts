import { useState } from "react";
import type { CandidateUserAction, WorkflowCandidate } from "@apprentice/schemas";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/hooks";
import { navigate } from "../../lib/router";
import { useStore } from "../../state/store";

const REJECTIONS: ReadonlySet<CandidateUserAction> = new Set(["not_useful", "wrong_boundaries", "private_workflow", "already_automated", "never_learn"]);

interface Options {
  onUpdated: (candidate: WorkflowCandidate) => void;
  onRejected: (candidateId: string) => void;
}

export interface CandidateActions {
  act: (candidate: WorkflowCandidate, action: CandidateUserAction) => Promise<void>;
  busyAction: CandidateUserAction | null;
  /** Candidate awaiting confirmation of "Never learn this pattern", if any. */
  pendingNeverLearn: WorkflowCandidate | null;
  confirmNeverLearn: () => Promise<void>;
  cancelNeverLearn: () => void;
}

/**
 * Shared candidate action handler: try once navigates to the run, edit navigates
 * to the skill, rejections open feedback. "Never learn" is permanent, so it is
 * held until the caller's confirmation dialog confirms it.
 */
export function useCandidateActions({ onUpdated, onRejected }: Options): CandidateActions {
  const { toast } = useStore();
  const [busyAction, setBusyAction] = useState<CandidateUserAction | null>(null);
  const [pendingNeverLearn, setPendingNeverLearn] = useState<WorkflowCandidate | null>(null);

  const perform = async (id: string, action: CandidateUserAction): Promise<void> => {
    setBusyAction(action);
    try {
      const result = await invoke("candidates:act", { id, action });
      onUpdated(result.candidate);
      if (action === "try_once" && result.run) {
        toast("info", "Run started in guide mode. Nothing happens without your approval.");
        navigate("runs", result.run.id);
      } else if (action === "edit_and_save" && result.skill) {
        toast("success", "Skill created. Review and adjust it before running.");
        navigate("skills", result.skill.id);
      } else if (REJECTIONS.has(action)) {
        toast("info", action === "never_learn" ? "This pattern will not be proposed again." : "Candidate hidden.");
        onRejected(id);
      } else {
        toast("warning", "The action completed but no skill or run was returned.");
      }
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusyAction(null);
    }
  };

  const act = async (candidate: WorkflowCandidate, action: CandidateUserAction): Promise<void> => {
    if (action === "never_learn") {
      setPendingNeverLearn(candidate);
      return;
    }
    await perform(candidate.id, action);
  };

  const confirmNeverLearn = async (): Promise<void> => {
    const candidate = pendingNeverLearn;
    if (!candidate) return;
    await perform(candidate.id, "never_learn");
    setPendingNeverLearn(null);
  };

  const cancelNeverLearn = (): void => setPendingNeverLearn(null);

  return { act, busyAction, pendingNeverLearn, confirmNeverLearn, cancelNeverLearn };
}
