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
import { CHROME, CONTACT_NAMES, DOMAINS } from "./constants.js";

const SCENARIO_SALT = 101;

/**
 * Meeting notes -> CRM activity log -> follow-up email -> task creation.
 * Variable data lives only in route ids, value lengths, and window titles.
 */
export function generateEpisode(opts: GenerateEpisodeOptions): GeneratedEpisode {
  const variant = opts.variant ?? 0;
  const rng = createRng(mixSeed(opts.seed, opts.occurrence, SCENARIO_SALT, variant));
  const meetingId = rng.hex(8);
  const contactId = rng.hex(12);
  const boardId = rng.hex(6);
  const contactName = rng.pick(CONTACT_NAMES);
  const summaryLength = rng.int(180, 420);
  const contactRoute = `/contact/${contactId}`;
  const notesRoute = `/meeting/${meetingId}`;
  const tasksRoute = `/board/${boardId}`;

  const specs: readonly StepSpec[] = [
    { type: "app_activated", app: CHROME, gap: [0, 0], shot: "notesPage" },
    { type: "navigation", domain: DOMAINS.notes, routePattern: notesRoute, gap: [3, 6], shot: "notesPage" },
    { type: "page_title", domain: DOMAINS.notes, routePattern: notesRoute, payload: { title: "Meeting notes" }, gap: [2, 4] },
    { type: "idle_changed", payload: { idle: false }, gap: [2, 4] },
    {
      type: "copy",
      domain: DOMAINS.notes,
      routePattern: notesRoute,
      element: { role: "textbox", name: "Summary" },
      payload: { length: summaryLength },
      gap: [25, 35]
    },
    { type: "clipboard_changed", payload: { kind: "text", length: summaryLength }, gap: [2, 3] },
    { type: "navigation", domain: DOMAINS.crm, routePattern: contactRoute, gap: [6, 12], shot: "crmContact" },
    { type: "window_title_changed", payload: { title: `${contactName} - Contacts` }, gap: [2, 4] },
    ...onlyVariant(variant, 1, [
      { type: "page_title", domain: DOMAINS.crm, routePattern: contactRoute, payload: { title: "Contact - CRM" }, gap: [2, 3] }
    ]),
    {
      type: "click",
      domain: DOMAINS.crm,
      routePattern: contactRoute,
      element: { role: "button", name: "Log activity" },
      gap: [6, 12],
      shot: "crmLogActivity"
    },
    {
      type: "field_input",
      domain: DOMAINS.crm,
      routePattern: contactRoute,
      element: { role: "combobox", name: "Activity type" },
      payload: { fieldLabel: "Activity type", valueLength: 7, inputType: "select" },
      gap: [4, 8]
    },
    {
      type: "paste",
      domain: DOMAINS.crm,
      routePattern: contactRoute,
      element: { role: "textbox", name: "Notes" },
      payload: { length: summaryLength },
      gap: [4, 8]
    },
    {
      type: "field_input",
      domain: DOMAINS.crm,
      routePattern: contactRoute,
      element: { role: "textbox", name: "Notes" },
      payload: { fieldLabel: "Notes", valueLength: summaryLength + rng.int(20, 80), inputType: "textarea" },
      gap: [25, 40]
    },
    {
      type: "click",
      domain: DOMAINS.crm,
      routePattern: contactRoute,
      element: { role: "button", name: "Save" },
      gap: [4, 8],
      shot: "crmContact"
    },
    { type: "navigation", domain: DOMAINS.mail, routePattern: "/compose", gap: [8, 15], shot: "mailCompose" },
    { type: "window_title_changed", payload: { title: "New message - Mail" }, gap: [2, 4] },
    {
      type: "field_input",
      domain: DOMAINS.mail,
      routePattern: "/compose",
      element: { role: "textbox", name: "To" },
      payload: { fieldLabel: "To", valueLength: rng.int(18, 32), inputType: "email" },
      gap: [6, 12]
    },
    {
      type: "field_input",
      domain: DOMAINS.mail,
      routePattern: "/compose",
      element: { role: "textbox", name: "Subject" },
      payload: { fieldLabel: "Subject", valueLength: rng.int(24, 60), inputType: "text" },
      gap: [8, 15]
    },
    {
      type: "field_input",
      domain: DOMAINS.mail,
      routePattern: "/compose",
      element: { role: "textbox", name: "Body" },
      payload: { fieldLabel: "Body", valueLength: rng.int(300, 900), inputType: "textarea" },
      gap: [35, 40]
    },
    {
      type: "click",
      domain: DOMAINS.mail,
      routePattern: "/compose",
      element: { role: "button", name: "Send" },
      gap: [4, 8],
      shot: "mailCompose"
    },
    { type: "navigation", domain: DOMAINS.tasks, routePattern: tasksRoute, gap: [8, 15], shot: "taskBoard" },
    { type: "page_title", domain: DOMAINS.tasks, routePattern: tasksRoute, payload: { title: "Board - Tasks" }, gap: [2, 4] },
    {
      type: "click",
      domain: DOMAINS.tasks,
      routePattern: tasksRoute,
      element: { role: "button", name: "New task" },
      gap: [5, 10],
      shot: "taskBoard"
    },
    {
      type: "field_input",
      domain: DOMAINS.tasks,
      routePattern: tasksRoute,
      element: { role: "textbox", name: "Title" },
      payload: { fieldLabel: "Title", valueLength: rng.int(20, 60), inputType: "text" },
      gap: [12, 25]
    },
    ...unlessVariant(variant, 2, [
      {
        type: "field_input",
        domain: DOMAINS.tasks,
        routePattern: tasksRoute,
        element: { role: "textbox", name: "Due date" },
        payload: { fieldLabel: "Due date", valueLength: 10, inputType: "date" },
        gap: [5, 10]
      }
    ]),
    ...onlyVariant(variant, 1, [
      {
        type: "field_input",
        domain: DOMAINS.tasks,
        routePattern: tasksRoute,
        element: { role: "combobox", name: "Priority" },
        payload: { fieldLabel: "Priority", valueLength: 6, inputType: "select" },
        gap: [4, 8]
      }
    ]),
    {
      type: "form_submit",
      domain: DOMAINS.tasks,
      routePattern: tasksRoute,
      element: { role: "form", name: "Create task" },
      payload: { purpose: "create" },
      gap: [4, 8],
      shot: "taskBoard"
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
