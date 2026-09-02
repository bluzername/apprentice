import { createRng, mixSeed } from "../prng.js";
import type { GeneratedEpisode, GenerateEpisodeOptions } from "../types.js";
import {
  activeDuration,
  buildEpisode,
  onlyVariant,
  unlessVariant,
  uniqueApps,
  uniqueDomains,
  type StepSpec
} from "./builder.js";
import { CANDIDATE_NAMES, CHROME, DOMAINS } from "./constants.js";

const SCENARIO_SALT = 303;

/**
 * ATS candidate page -> resume review -> interview notes -> status change -> interview scheduling.
 */
export function generateEpisode(opts: GenerateEpisodeOptions): GeneratedEpisode {
  const variant = opts.variant ?? 0;
  const rng = createRng(mixSeed(opts.seed, opts.occurrence, SCENARIO_SALT, variant));
  const candidateId = rng.hex(12);
  const docId = rng.hex(8);
  const candidateName = rng.pick(CANDIDATE_NAMES);
  const candidateRoute = `/candidates/${candidateId}`;
  const notesRoute = `/doc/${docId}`;
  const scheduleRoute = "/schedule";
  const scroll: StepSpec = {
    type: "shortcut",
    domain: DOMAINS.ats,
    routePattern: candidateRoute,
    payload: { keys: "pagedown", intent: "scroll" },
    gap: [20, 35]
  };

  const specs: readonly StepSpec[] = [
    { type: "app_activated", app: CHROME, gap: [0, 0], shot: "atsCandidate" },
    { type: "navigation", domain: DOMAINS.ats, routePattern: candidateRoute, gap: [3, 6], shot: "atsCandidate" },
    { type: "page_title", domain: DOMAINS.ats, routePattern: candidateRoute, payload: { title: "Candidate - ATS" }, gap: [2, 4] },
    { type: "window_title_changed", payload: { title: `${candidateName} - ATS` }, gap: [2, 4] },
    {
      type: "click",
      domain: DOMAINS.ats,
      routePattern: candidateRoute,
      element: { role: "tab", name: "Resume" },
      gap: [8, 15],
      shot: "atsCandidate"
    },
    { ...scroll, gap: [25, 40] },
    ...unlessVariant(variant, 2, [scroll]),
    { type: "navigation", domain: DOMAINS.notes, routePattern: notesRoute, gap: [10, 18], shot: "notesPage" },
    { type: "page_title", domain: DOMAINS.notes, routePattern: notesRoute, payload: { title: "Interview notes" }, gap: [2, 4] },
    {
      type: "field_input",
      domain: DOMAINS.notes,
      routePattern: notesRoute,
      element: { role: "textbox", name: "Title" },
      payload: { fieldLabel: "Title", valueLength: rng.int(16, 40), inputType: "text" },
      gap: [8, 15]
    },
    {
      type: "field_input",
      domain: DOMAINS.notes,
      routePattern: notesRoute,
      element: { role: "textbox", name: "Body" },
      payload: { fieldLabel: "Body", valueLength: rng.int(200, 600), inputType: "textarea" },
      gap: [40, 40]
    },
    { type: "idle_changed", payload: { idle: false }, gap: [2, 4] },
    { type: "navigation", domain: DOMAINS.ats, routePattern: candidateRoute, gap: [6, 12], shot: "atsCandidate" },
    {
      type: "click",
      domain: DOMAINS.ats,
      routePattern: candidateRoute,
      element: { role: "button", name: "Change status" },
      gap: [8, 14],
      shot: "atsStatusDialog"
    },
    {
      type: "field_input",
      domain: DOMAINS.ats,
      routePattern: candidateRoute,
      element: { role: "combobox", name: "Status" },
      payload: { fieldLabel: "Status", valueLength: rng.int(6, 12), inputType: "select" },
      gap: [5, 10]
    },
    ...onlyVariant(variant, 1, [
      {
        type: "field_input",
        domain: DOMAINS.ats,
        routePattern: candidateRoute,
        element: { role: "textbox", name: "Reason" },
        payload: { fieldLabel: "Reason", valueLength: rng.int(20, 80), inputType: "textarea" },
        gap: [8, 15]
      }
    ]),
    {
      type: "click",
      domain: DOMAINS.ats,
      routePattern: candidateRoute,
      element: { role: "button", name: "Update" },
      gap: [4, 8],
      shot: "atsCandidate"
    },
    { type: "navigation", domain: DOMAINS.calendar, routePattern: scheduleRoute, gap: [8, 15], shot: "calendarSchedule" },
    ...onlyVariant(variant, 1, [{ type: "clipboard_changed", payload: { kind: "text", length: 24 }, gap: [2, 4] }]),
    {
      type: "click",
      domain: DOMAINS.calendar,
      routePattern: scheduleRoute,
      element: { role: "button", name: "Schedule" },
      gap: [6, 12],
      shot: "calendarSchedule"
    },
    {
      type: "field_input",
      domain: DOMAINS.calendar,
      routePattern: scheduleRoute,
      element: { role: "textbox", name: "Title" },
      payload: { fieldLabel: "Title", valueLength: rng.int(18, 40), inputType: "text" },
      gap: [12, 20]
    },
    {
      type: "field_input",
      domain: DOMAINS.calendar,
      routePattern: scheduleRoute,
      element: { role: "textbox", name: "Date" },
      payload: { fieldLabel: "Date", valueLength: 16, inputType: "datetime" },
      gap: [6, 12]
    },
    {
      type: "field_input",
      domain: DOMAINS.calendar,
      routePattern: scheduleRoute,
      element: { role: "textbox", name: "Guests" },
      payload: { fieldLabel: "Guests", valueLength: rng.int(20, 50), inputType: "email" },
      gap: [8, 15]
    },
    {
      type: "form_submit",
      domain: DOMAINS.calendar,
      routePattern: scheduleRoute,
      element: { role: "form", name: "Schedule interview" },
      payload: { purpose: "create" },
      gap: [3, 6],
      shot: "calendarSchedule"
    }
  ];

  const built = buildEpisode(specs, { rng, sessionId: opts.sessionId, startTs: opts.startTs, seqStart: opts.seqStart });
  return {
    events: [...built.events],
    screenshotRefs: [...built.screenshotRefs],
    expected: {
      apps: [...uniqueApps(built.events)],
      domains: [...uniqueDomains(built.events)],
      outcomeType: "form_submit:create",
      activeDurationMs: activeDuration(built.events)
    }
  };
}
