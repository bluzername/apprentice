import type { JSX } from "react";
import type { ActionPolicyMode } from "@apprentice/schemas";
import { RadioGroup } from "../../components/Field";
import { useStore } from "../../state/store";

interface PolicySelectProps {
  value: ActionPolicyMode;
  onChange: (mode: ActionPolicyMode) => void;
}

/** Approval policy picker. low_risk_auto only appears when the experimental flag is on. */
export function PolicySelect({ value, onChange }: PolicySelectProps): JSX.Element {
  const { state } = useStore();
  const lowRiskAuto = state.settings?.experimental.lowRiskAuto ?? false;
  const options: Array<{ value: ActionPolicyMode; label: string; hint: string }> = [
    { value: "suggest_only", label: "Suggest only", hint: "Shows each proposed action. Nothing is executed." },
    { value: "guide", label: "Guide", hint: "Proposes one action at a time and waits for your approval. Recommended." },
    { value: "approval_every_step", label: "Approve every step", hint: "Like guide, but never continues low-risk actions on a run-level approval." }
  ];
  if (lowRiskAuto) {
    options.push({ value: "low_risk_auto", label: "Low-risk auto (experimental)", hint: "Read-only and scroll actions run without asking. Typing, sending and navigation still require approval." });
  }
  return <RadioGroup legend="Approval policy" value={value} onValueChange={onChange} options={options} />;
}
