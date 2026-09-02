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
import { CHROME, COMPANY_NAMES, DOMAINS, FINDER, PREVIEW } from "./constants.js";

const SCENARIO_SALT = 202;

/**
 * Invoice email -> PDF download -> rename in Preview -> file in Finder ->
 * bill upload in accounting -> confirmation message in chat.
 */
export function generateEpisode(opts: GenerateEpisodeOptions): GeneratedEpisode {
  const variant = opts.variant ?? 0;
  const rng = createRng(mixSeed(opts.seed, opts.occurrence, SCENARIO_SALT, variant));
  const messageId = rng.hex(10);
  const invoiceNumber = rng.int(2000, 4999);
  const channelId = rng.hex(6);
  const company = rng.pick(COMPANY_NAMES);
  const filenameLength = rng.int(14, 28);
  const renamedLength = rng.int(20, 34);
  const mailRoute = `/inbox/${messageId}`;
  const chatRoute = `/channel/${channelId}`;
  const accountingRoute = "/bills/new";

  const specs: readonly StepSpec[] = [
    { type: "app_activated", app: CHROME, gap: [0, 0], shot: "invoiceEmail" },
    { type: "navigation", domain: DOMAINS.mail, routePattern: mailRoute, gap: [3, 6], shot: "invoiceEmail" },
    { type: "page_title", domain: DOMAINS.mail, routePattern: mailRoute, payload: { title: `Invoice INV-${invoiceNumber} - Mail` }, gap: [2, 4] },
    { type: "idle_changed", payload: { idle: false }, gap: [2, 4] },
    {
      type: "click",
      domain: DOMAINS.mail,
      routePattern: mailRoute,
      element: { role: "button", name: "Download" },
      gap: [20, 35],
      shot: "invoiceEmail"
    },
    {
      type: "download",
      domain: DOMAINS.mail,
      routePattern: mailRoute,
      payload: { extension: "pdf", filenameLength },
      gap: [3, 6]
    },
    { type: "app_activated", app: FINDER, gap: [6, 12], shot: "finderWindow" },
    { type: "window_title_changed", app: FINDER, payload: { title: "Downloads" }, gap: [2, 4] },
    {
      type: "click",
      app: FINDER,
      element: { role: "AXRow", name: "PDF document" },
      payload: { clicks: 2 },
      gap: [8, 15],
      shot: "finderWindow"
    },
    { type: "app_activated", app: PREVIEW, gap: [3, 6], shot: "previewPdf" },
    { type: "window_title_changed", app: PREVIEW, payload: { title: `INV-${invoiceNumber}.pdf` }, gap: [2, 4] },
    ...onlyVariant(variant, 1, [{ type: "clipboard_changed", app: PREVIEW, payload: { kind: "text", length: 8 }, gap: [2, 4] }]),
    { type: "shortcut", app: PREVIEW, payload: { keys: "cmd+shift+s" }, gap: [10, 20] },
    {
      type: "field_input",
      app: PREVIEW,
      element: { role: "AXTextField", name: "Save As" },
      payload: { fieldLabel: "Save As", valueLength: renamedLength, inputType: "text" },
      gap: [15, 25]
    },
    { type: "click", app: PREVIEW, element: { role: "AXButton", name: "Save" }, gap: [4, 8], shot: "previewPdf" },
    { type: "app_activated", app: FINDER, gap: [6, 12], shot: "finderWindow" },
    { type: "click", app: FINDER, element: { role: "AXRow", name: "PDF document" }, gap: [6, 12] },
    { type: "click", app: FINDER, element: { role: "AXMenuItem", name: "Move to" }, gap: [6, 12], shot: "finderWindow" },
    { type: "click", app: FINDER, element: { role: "AXMenuItem", name: "Invoices" }, gap: [4, 8] },
    { type: "app_activated", app: CHROME, gap: [8, 15], shot: "accountingUpload" },
    { type: "navigation", domain: DOMAINS.accounting, routePattern: accountingRoute, gap: [3, 6], shot: "accountingUpload" },
    { type: "page_title", domain: DOMAINS.accounting, routePattern: accountingRoute, payload: { title: "New bill - Accounting" }, gap: [2, 4] },
    {
      type: "click",
      domain: DOMAINS.accounting,
      routePattern: accountingRoute,
      element: { role: "button", name: "Upload" },
      gap: [10, 18],
      shot: "accountingUpload"
    },
    {
      type: "field_input",
      domain: DOMAINS.accounting,
      routePattern: accountingRoute,
      element: { role: "textbox", name: "Amount" },
      payload: { fieldLabel: "Amount", valueLength: rng.int(5, 9), inputType: "text" },
      gap: [12, 20]
    },
    ...unlessVariant(variant, 2, [
      {
        type: "field_input",
        domain: DOMAINS.accounting,
        routePattern: accountingRoute,
        element: { role: "textbox", name: "Due date" },
        payload: { fieldLabel: "Due date", valueLength: 10, inputType: "date" },
        gap: [8, 14]
      }
    ]),
    {
      type: "click",
      domain: DOMAINS.accounting,
      routePattern: accountingRoute,
      element: { role: "button", name: "Save bill" },
      gap: [6, 10],
      shot: "accountingUpload"
    },
    { type: "navigation", domain: DOMAINS.chat, routePattern: chatRoute, gap: [8, 15], shot: "chatMessage" },
    ...onlyVariant(variant, 1, [
      { type: "window_title_changed", payload: { title: `${company} channel - Chat` }, gap: [2, 4] }
    ]),
    {
      type: "field_input",
      domain: DOMAINS.chat,
      routePattern: chatRoute,
      element: { role: "textbox", name: "Message" },
      payload: { fieldLabel: "Message", valueLength: rng.int(40, 140), inputType: "textarea" },
      gap: [25, 40]
    },
    {
      type: "form_submit",
      domain: DOMAINS.chat,
      routePattern: chatRoute,
      element: { role: "form", name: "Send message" },
      payload: { purpose: "message" },
      gap: [3, 6],
      shot: "chatMessage"
    }
  ];

  const built = buildEpisode(specs, { rng, sessionId: opts.sessionId, startTs: opts.startTs, seqStart: opts.seqStart });
  return {
    events: [...built.events],
    screenshotRefs: [...built.screenshotRefs],
    expected: {
      apps: [...uniqueApps(built.events)],
      domains: [...uniqueDomains(built.events)],
      outcomeType: "form_submit:message",
      activeDurationMs: activeDuration(built.events)
    }
  };
}
