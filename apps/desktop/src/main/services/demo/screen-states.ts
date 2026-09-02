import type { TemplateName } from "../../../../../../packages/test-fixtures/src/types.js";

/** Deterministic semantic state of each fixture screen so verification is real, not faked. */
export interface DemoScreenState {
  readonly template: TemplateName;
  readonly bundleId: string;
  readonly appName: string;
  /** Domain for browser screens; undefined for native apps. */
  readonly domain?: string;
  readonly path?: string;
  readonly windowTitle: string;
  /** Words visible on the screen (fed to OCR); the target label is added automatically. */
  readonly words: readonly string[];
  readonly domMarkers: readonly string[];
}

const CHROME = { bundleId: "com.google.Chrome", appName: "Google Chrome" } as const;

export const DEMO_SCREEN_STATES: Readonly<Record<TemplateName, DemoScreenState>> = {
  crmContact: { template: "crmContact", ...CHROME, domain: "crm.example", path: "/contact/1042", windowTitle: "Jordan Rivera - Contacts - CRM", words: ["Contacts", "Jordan Rivera", "Acme Ltd", "Recent activity", "Meeting logged"], domMarkers: [] },
  crmLogActivity: { template: "crmLogActivity", ...CHROME, domain: "crm.example", path: "/contact/1042/activity/new", windowTitle: "Log activity - CRM", words: ["Log activity", "Meeting", "Notes", "Cancel"], domMarkers: [] },
  mailCompose: { template: "mailCompose", ...CHROME, domain: "mail.example", path: "/compose", windowTitle: "New message - Mail", words: ["New message", "To", "Subject", "Draft saved"], domMarkers: [] },
  taskBoard: { template: "taskBoard", ...CHROME, domain: "tasks.example", path: "/board/7", windowTitle: "Sprint board - Tasks", words: ["To do", "In progress", "Done", "Contract review"], domMarkers: [] },
  notesPage: { template: "notesPage", ...CHROME, domain: "notes.example", path: "/meeting/1042", windowTitle: "Meeting notes - Notes", words: ["Meeting notes", "Summary", "Next steps", "Jordan Rivera"], domMarkers: [] },
  invoiceEmail: { template: "invoiceEmail", ...CHROME, domain: "mail.example", path: "/inbox/9931", windowTitle: "Invoice INV-2041 - Mail", words: ["Invoice", "INV-2041", "Acme Ltd", "Attachment"], domMarkers: [] },
  finderWindow: { template: "finderWindow", bundleId: "com.apple.finder", appName: "Finder", windowTitle: "Invoices", words: ["Invoices", "Downloads", "2026-09-01_acme_INV-2041.pdf"], domMarkers: [] },
  previewPdf: { template: "previewPdf", bundleId: "com.apple.Preview", appName: "Preview", windowTitle: "INV-2041.pdf", words: ["Invoice", "Total", "Acme Ltd", "Export"], domMarkers: [] },
  accountingUpload: { template: "accountingUpload", ...CHROME, domain: "accounting.example", path: "/bills/new", windowTitle: "New bill - Accounting", words: ["New bill", "Upload", "Amount", "Due date", "Save bill"], domMarkers: [] },
  atsCandidate: { template: "atsCandidate", ...CHROME, domain: "ats.example", path: "/candidates/318", windowTitle: "Jordan Rivera - Candidates - ATS", words: ["Candidates", "Resume", "Interview", "Phone screen"], domMarkers: [] },
  atsStatusDialog: { template: "atsStatusDialog", ...CHROME, domain: "ats.example", path: "/candidates/318", windowTitle: "Change status - ATS", words: ["Change status", "Interview", "Cancel"], domMarkers: [] },
  calendarSchedule: { template: "calendarSchedule", ...CHROME, domain: "calendar.example", path: "/schedule", windowTitle: "Schedule - Calendar", words: ["Schedule", "Title", "Guests", "Interview"], domMarkers: ["event-created"] },
  chatMessage: { template: "chatMessage", ...CHROME, domain: "chat.example", path: "/channel/finance", windowTitle: "#finance - Chat", words: ["finance", "Message", "Filed INV-2041"], domMarkers: [] },
  newsFeed: { template: "newsFeed", ...CHROME, domain: "news.example", path: "/", windowTitle: "Top stories - News", words: ["Top stories", "Latest"], domMarkers: [] },
  genericBlank: { template: "genericBlank", ...CHROME, windowTitle: "Untitled", words: ["Untitled"], domMarkers: [] }
};

/** Context key comparable with skill subtask `appOrDomain` values (domain or app slug/bundle id). */
export function stateContextKeys(state: DemoScreenState): readonly string[] {
  const keys = [state.bundleId.toLowerCase(), state.appName.toLowerCase()];
  const slug = state.bundleId.split(".").pop()?.toLowerCase();
  if (slug) keys.push(slug);
  if (state.domain) keys.push(state.domain);
  return keys;
}

export function contextMatches(state: DemoScreenState, appOrDomain: string | undefined): boolean {
  if (!appOrDomain) return false;
  const wanted = appOrDomain.toLowerCase();
  return stateContextKeys(state).some((key) => key === wanted || key.endsWith(`.${wanted}`) || wanted.endsWith(`.${key}`));
}
