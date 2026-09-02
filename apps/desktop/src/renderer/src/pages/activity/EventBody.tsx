import type { JSX } from "react";
import type { ActivityEvent, ScreenshotRecord } from "@apprentice/schemas";
import { Badge } from "../../components/Badge";
import { ScreenshotThumb } from "../../components/ScreenshotThumb";
import { humanize } from "../../lib/format";

export function eventTitle(event: ActivityEvent): string {
  switch (event.type) {
    case "app_activated":
      return `Switched to ${event.app?.name ?? event.domain ?? "an app"}`;
    case "navigation":
      return `Navigated to ${event.domain ?? "a page"}${event.routePattern ? ` ${event.routePattern}` : ""}`;
    case "click":
      return `Clicked ${event.element?.name ?? event.element?.ariaLabel ?? event.element?.role ?? "an element"}`;
    case "form_submit":
      return `Submitted a form${event.payload?.formPurpose ? ` (${String(event.payload.formPurpose)})` : ""}`;
    case "shortcut":
      return `Shortcut ${Array.isArray(event.payload?.keys) ? event.payload.keys.join(" + ") : ""}`.trim();
    case "privacy_gap":
      return "Not captured: app outside your allowlist";
    default:
      return humanize(event.type);
  }
}

export function eventLocation(event: ActivityEvent): string {
  return [event.app?.name, event.domain].filter(Boolean).join(" / ");
}

interface EventBodyProps {
  event: ActivityEvent;
  screenshot?: ScreenshotRecord;
}

export function EventBody({ event, screenshot }: EventBodyProps): JSX.Element {
  return (
    <div>
      <div className="row">
        <span className="event-type">{eventTitle(event)}</span>
        {event.privacy === "sensitive" ? <Badge tone="warning">Sensitive</Badge> : null}
        {event.redaction === "redacted" ? <Badge tone="neutral">Redacted</Badge> : null}
        {event.source === "extension" ? <Badge tone="neutral">Browser</Badge> : null}
      </div>
      <div className="event-meta">
        {eventLocation(event)}
        {event.element?.role ? ` , ${event.element.role}` : ""}
      </div>
      {screenshot ? (
        <div className="event-shot">
          <ScreenshotThumb id={screenshot.id} width={screenshot.width} height={screenshot.height} maxWidth={200} label={eventTitle(event)} />
        </div>
      ) : null}
    </div>
  );
}
