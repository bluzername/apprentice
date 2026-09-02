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

/** Shared candidate action handler: try once navigates to the run, edit navigates to the skill, rejections open feedback. */
export function useCandidateActions({ onUpdated, onRejected }: Options): { act: (id: string, action: CandidateUserAction) => Promise<void>; busyAction: CandidateUserAction | null } {
  const { toast } = useStore();
  const [busyAction, setBusyAction] = useState<CandidateUserAction | null>(null);

  const act = async (id: string, action: CandidateUserAction): Promise<void> => {
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
  return { act, busyAction };
}
