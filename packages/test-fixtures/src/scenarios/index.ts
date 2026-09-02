import type { ScenarioGenerator, ScenarioName } from "../types.js";
import { generateEpisode as postMeetingFollowup } from "./postMeetingFollowup.js";
import { generateEpisode as invoiceProcessing } from "./invoiceProcessing.js";
import { generateEpisode as candidateReview } from "./candidateReview.js";

export const SCENARIO_GENERATORS: Readonly<Record<ScenarioName, ScenarioGenerator>> = {
  postMeetingFollowup,
  invoiceProcessing,
  candidateReview
};

export { postMeetingFollowup, invoiceProcessing, candidateReview };
export { countMeaningfulActions, eventId, screenshotId } from "./builder.js";
export { CHROME, FINDER, PREVIEW, DOMAINS } from "./constants.js";
