import type { JSX } from "react";
import { Badge } from "../../components/Badge";
import { acceleratorLabel } from "../../lib/accelerator";
import { useStore } from "../../state/store";

export function StepStart(): JSX.Element {
  const { state } = useStore();
  const settings = state.settings;
  const allowlistEmpty = settings ? settings.allowlist.apps.length === 0 && settings.allowlist.domains.length === 0 : true;
  return (
    <div className="stack">
      <h2>Start Learning mode</h2>
      <p>When you finish, Apprentice starts observing the apps and domains you allowed. The menu bar icon always shows what it is doing:</p>
      <div className="row">
        <Badge tone="success" dot>Learning</Badge>
        <Badge tone="warning" dot>Paused</Badge>
        <Badge tone="warning" dot>Private</Badge>
        <Badge tone="info" dot>Processing locally</Badge>
        <Badge tone="danger" dot>Model unavailable</Badge>
        <Badge tone="neutral" dot>Stopped</Badge>
      </div>
      <ul>
        <li>Pause for 15 minutes, pause until resumed, or switch to Private mode from the menu bar or the status chip in the app header.</li>
        <li>Press <kbd>{acceleratorLabel(settings?.shortcuts.teach ?? "Alt+Command+L")}</kbd> anywhere to open "Learn what I just did".</li>
        <li>Stop all local model work at any time from the same menu.</li>
      </ul>
      {allowlistEmpty ? <div className="callout callout-warning">Your allowlist is empty, so nothing will be captured yet. You can add apps and domains in Settings at any time.</div> : null}
      {settings?.demoMode ? <div className="callout">Demo mode is on: the timeline and candidates are synthetic until you turn it off in Settings.</div> : null}
    </div>
  );
}
