import type { JSX } from "react";
import type { ScreenshotRecord } from "@apprentice/schemas";
import { ScreenshotThumb } from "../../components/ScreenshotThumb";
import { screenshotLocation, screenshotTitle } from "../../lib/activity-items";

interface ScreenshotBodyProps {
  screenshot: ScreenshotRecord;
}

/** A screenshot with no event of its own in the list (interval or run captures). */
export function ScreenshotBody({ screenshot }: ScreenshotBodyProps): JSX.Element {
  const title = screenshotTitle(screenshot);
  const location = screenshotLocation(screenshot);
  return (
    <div>
      <div className="row">
        <span className="event-type">{title}</span>
      </div>
      {location ? <div className="event-meta">{location}</div> : null}
      <div className="event-shot">
        <ScreenshotThumb id={screenshot.id} width={screenshot.width} height={screenshot.height} maxWidth={200} label={location ? `${title}, ${location}` : title} />
      </div>
    </div>
  );
}
