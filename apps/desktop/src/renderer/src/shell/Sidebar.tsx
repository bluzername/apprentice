import type { JSX } from "react";
import { PRODUCT_NAME } from "@apprentice/schemas";
import { Icon, type IconName } from "../components/Icon";
import { buildHash, type PageName } from "../lib/router";
import { useStore } from "../state/store";

const NAV: ReadonlyArray<{ page: PageName; label: string; icon: IconName }> = [
  { page: "overview", label: "Overview", icon: "overview" },
  { page: "activity", label: "Activity", icon: "activity" },
  { page: "candidates", label: "Candidates", icon: "candidates" },
  { page: "skills", label: "Skills", icon: "skills" },
  { page: "runs", label: "Runs", icon: "runs" },
  { page: "feedback", label: "Feedback", icon: "feedback" },
  { page: "privacy", label: "Privacy", icon: "privacy" },
  { page: "settings", label: "Settings", icon: "settings" }
];

export function Sidebar(): JSX.Element {
  const { state } = useStore();
  const current = state.route.page === "teach" ? "activity" : state.route.page;
  return (
    <nav className="sidebar" aria-label="Main">
      <div className="brand">
        <Icon name="logo" size={24} />
        <span>{PRODUCT_NAME}</span>
      </div>
      {NAV.map((item) => (
        <a key={item.page} className="nav-link" href={buildHash(item.page)} aria-current={current === item.page ? "page" : undefined}>
          <Icon name={item.icon} />
          <span>{item.label}</span>
        </a>
      ))}
      <div className="nav-footer">
        {state.version ? <div>v{state.version.version}</div> : null}
        {state.settings?.demoMode ? <div>Demo mode</div> : null}
      </div>
    </nav>
  );
}
