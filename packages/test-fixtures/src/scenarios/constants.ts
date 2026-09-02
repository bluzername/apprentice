import type { AppRef } from "@apprentice/schemas";

export const CHROME: AppRef = { bundleId: "com.google.Chrome", name: "Google Chrome" };
export const FINDER: AppRef = { bundleId: "com.apple.finder", name: "Finder" };
export const PREVIEW: AppRef = { bundleId: "com.apple.Preview", name: "Preview" };

export const DOMAINS = {
  crm: "crm.example",
  notes: "notes.example",
  mail: "mail.example",
  tasks: "tasks.example",
  ats: "ats.example",
  accounting: "accounting.example",
  chat: "chat.example",
  calendar: "calendar.example",
  news: "news.example",
  video: "video.example",
  social: "social.example",
  bank: "bank.example"
} as const;

export const CONTACT_NAMES = [
  "Jordan Rivera",
  "Sam Okafor",
  "Priya Natarajan",
  "Alex Lindqvist",
  "Morgan Adeyemi",
  "Taylor Brennan",
  "Casey Delgado"
] as const;

export const COMPANY_NAMES = ["Acme Ltd", "Northwind Traders", "Bluebird Studio", "Harbor Supply Co", "Ridgeline Labs"] as const;

export const CANDIDATE_NAMES = [
  "Jordan Rivera",
  "Riley Hoffmann",
  "Dana Kowalski",
  "Kai Mensah",
  "Noor Haddad",
  "Elliot Sato"
] as const;

/** Screenshot cadence limit outside a run (privacy invariant 3). */
export const MIN_SCREENSHOT_INTERVAL_MS = 5000;

/** Second-granularity gap bounds used by every scenario step. */
export const MIN_GAP_S = 2;
export const MAX_GAP_S = 40;
