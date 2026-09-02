import type { Rect } from "@apprentice/schemas";
import {
  BROWSER_CHROME_HEIGHT,
  COLORS,
  browserChrome,
  button,
  card,
  inputField,
  line,
  modalBackdrop,
  page,
  paragraphLines,
  sidebar,
  text
} from "./primitives.js";
import { resolveVariant, type ScreenTemplate } from "./template.js";

const NAV = ["Contacts", "Companies", "Deals", "Activities", "Reports"];
const LOG_ACTIVITY: Rect = { x: 1200, y: 132, width: 160, height: 40 };
const SAVE_ACTIVITY: Rect = { x: 888, y: 668, width: 120, height: 40 };

function contactBody(title: string, primaryLabel: string): string {
  const top = BROWSER_CHROME_HEIGHT;
  return [
    browserChrome("https://crm.example/contact/8f2a1c9e4b7d", "Contacts - CRM"),
    sidebar(220, top, NAV, 0),
    text(260, top + 60, title, 26, COLORS.ink, 'font-weight="600"'),
    text(260, top + 88, "Acme Ltd  -  Head of Operations", 14, COLORS.muted),
    button(LOG_ACTIVITY, primaryLabel),
    card({ x: 260, y: top + 120, width: 640, height: 220 }),
    text(280, top + 150, "Details", 16, COLORS.ink, 'font-weight="600"'),
    text(280, top + 184, "Email", 12, COLORS.muted),
    text(280, top + 204, "jordan@acme.example", 14),
    text(560, top + 184, "Phone", 12, COLORS.muted),
    text(560, top + 204, "+1 555 0100", 14),
    text(280, top + 244, "Owner", 12, COLORS.muted),
    text(280, top + 264, "You", 14),
    text(560, top + 244, "Stage", 12, COLORS.muted),
    text(560, top + 264, "Qualified", 14),
    card({ x: 260, y: top + 360, width: 640, height: 380 }),
    text(280, top + 390, "Recent activity", 16, COLORS.ink, 'font-weight="600"'),
    line(280, top + 404, 880, top + 404),
    text(280, top + 432, "Call  -  Intro call with Jordan", 14),
    text(280, top + 452, "2 days ago", 12, COLORS.muted),
    paragraphLines(280, top + 470, 560, 3),
    text(280, top + 560, "Email  -  Proposal follow-up", 14),
    text(280, top + 580, "1 week ago", 12, COLORS.muted),
    paragraphLines(280, top + 598, 560, 3),
    card({ x: 930, y: top + 120, width: 430, height: 620 }),
    text(950, top + 150, "Open deals", 16, COLORS.ink, 'font-weight="600"'),
    paragraphLines(950, top + 176, 380, 6)
  ].join("");
}

export const crmContact: ScreenTemplate = {
  name: "crmContact",
  primaryLabel: "Log activity",
  primaryButton: LOG_ACTIVITY,
  render: (variant) => {
    const v = resolveVariant(variant, { title: "Jordan Rivera", primaryLabel: "Log activity" });
    return page(contactBody(v.title, v.primaryLabel), v.highlight);
  }
};

export const crmLogActivity: ScreenTemplate = {
  name: "crmLogActivity",
  primaryLabel: "Save",
  primaryButton: SAVE_ACTIVITY,
  render: (variant) => {
    const v = resolveVariant(variant, { title: "Log activity", primaryLabel: "Save" });
    const dialog: Rect = { x: 420, y: 180, width: 600, height: 550 };
    const body = [
      contactBody("Jordan Rivera", "Log activity"),
      modalBackdrop(),
      card(dialog),
      text(444, 222, v.title, 20, COLORS.ink, 'font-weight="600"'),
      text(444, 246, "Jordan Rivera  -  Acme Ltd", 13, COLORS.muted),
      inputField(444, 290, 552, "Activity type", "Meeting"),
      inputField(444, 360, 552, "Date", "Today"),
      text(444, 422, "Notes", 12, COLORS.muted),
      `<rect x="444" y="430" width="552" height="200" rx="5" fill="${COLORS.surface}" stroke="${COLORS.border}"/>`,
      paragraphLines(458, 450, 520, 6),
      button({ x: 748, y: 668, width: 120, height: 40 }, "Cancel", false),
      button(SAVE_ACTIVITY, v.primaryLabel)
    ].join("");
    return page(body, v.highlight);
  }
};
