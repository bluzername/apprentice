import type { JSX, ReactNode } from "react";
import type { RiskClass } from "@apprentice/schemas";
import { riskLabel, riskTone } from "../lib/format";

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info" | "low" | "medium" | "high" | "accent";

interface BadgeProps {
  tone?: BadgeTone;
  dot?: boolean;
  children: ReactNode;
  title?: string;
}

export function Badge({ tone = "neutral", dot = false, children, title }: BadgeProps): JSX.Element {
  return (
    <span className={`badge badge-${tone}${dot ? " badge-dot" : ""}`} title={title}>
      {children}
    </span>
  );
}

export function RiskBadge({ risk }: { risk: RiskClass }): JSX.Element {
  return <Badge tone={riskTone(risk)} title={`Risk class: ${risk}`}>{riskLabel(risk)}</Badge>;
}
