import { useEffect, useRef, type JSX, type ReactNode } from "react";
import { PRODUCT_NAME } from "@apprentice/schemas";
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
  const title = TITLES[state.route.page] ?? PRODUCT_NAME;
  const approval = state.pendingApproval;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const previousRoute = useRef<string | null>(null);
  const routeKey = `${state.route.page}/${state.route.id ?? ""}`;

  // Route changes in a hash router do not reload the document: update the window
  // title and move focus to the page heading so the change is announced.
  useEffect(() => {
    document.title = `${title} - ${PRODUCT_NAME}`;
    if (previousRoute.current !== null && previousRoute.current !== routeKey) headingRef.current?.focus();
    previousRoute.current = routeKey;
  }, [title, routeKey]);

  return (
    <div className="shell">
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          // Plain hash navigation would be parsed as a route; focus the landmark directly.
          e.preventDefault();
          mainRef.current?.focus();
        }}
      >
        Skip to content
      </a>
      <Sidebar />
      <header className="header">
        <h1 ref={headingRef} tabIndex={-1}>
          {title}
        </h1>
        <span className="spacer" />
        {approval && !(state.route.page === "runs" && state.route.id === approval.runId) ? (
          <a className="btn btn-sm" href={buildHash("runs", approval.runId)}>
            Approval needed: {approval.subtaskTitle}
          </a>
        ) : null}
        {state.helper && !state.helper.connected ? <Badge tone="warning">Helper disconnected</Badge> : null}
        <StatusChip />
      </header>
      <main className="main" id="main" ref={mainRef} tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
