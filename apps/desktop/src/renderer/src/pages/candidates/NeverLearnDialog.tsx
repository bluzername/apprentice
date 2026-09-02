import type { JSX } from "react";
import { PRODUCT_NAME } from "@apprentice/schemas";
import { ConfirmDialog } from "../../components/Dialog";
import { candidateTitle } from "./CandidateCard";
import type { CandidateActions } from "./useCandidateActions";

type NeverLearnDialogProps = Pick<CandidateActions, "pendingNeverLearn" | "busyAction" | "confirmNeverLearn" | "cancelNeverLearn">;

/** Confirms the permanent "never learn" rejection, naming the candidate. */
export function NeverLearnDialog({ pendingNeverLearn, busyAction, confirmNeverLearn, cancelNeverLearn }: NeverLearnDialogProps): JSX.Element {
  return (
    <ConfirmDialog
      open={pendingNeverLearn !== null}
      title="Never learn this pattern?"
      message={pendingNeverLearn ? `"${candidateTitle(pendingNeverLearn)}" will be hidden and ${PRODUCT_NAME} will stop proposing this pattern, even if it is observed again. This cannot be undone from the app.` : ""}
      confirmLabel="Never learn this pattern"
      danger
      busy={busyAction === "never_learn"}
      onConfirm={() => void confirmNeverLearn()}
      onCancel={cancelNeverLearn}
    />
  );
}
