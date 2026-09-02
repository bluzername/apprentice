import type { JSX, ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { StatusChip } from "./StatusChip";
import { Badge } from "../components/Badge";
import { useStore } from "../state/store";
import { buildHash } from "../lib/router";

const TITLES: Record<string, string> = {
  overview: "Overview",
  activity: "Activity",
  candidates: "Candidates",
  skills: "Skills",
  runs: "Runs",
  feedback: "Feedback",
  privacy: "Privacy",
  settings: "Settings",
  teach: "Learn what I just did",
  onboarding: "Setup"
};

export function AppShell({ children }: { children: ReactNode }): JSX.Element {
  const { state } = useStore();
  const title = TITLES[state.route.page] ?? "Apprentice";
  const approval = state.pendingApproval;
  return (
    <div className="shell">
      <Sidebar />
      <header className="header">
        <h1>{title}</h1>
        <span className="spacer" />
        {approval && !(state.route.page === "runs" && state.route.id === approval.runId) ? (
          <a className="badge badge-warning" href={buildHash("runs", approval.runId)}>
            Approval needed: {approval.subtaskTitle}
          </a>
        ) : null}
        {state.helper && !state.helper.connected ? <Badge tone="warning">Helper disconnected</Badge> : null}
        <StatusChip />
      </header>
      <main className="main" id="main">
        {children}
      </main>
    </div>
  );
}
