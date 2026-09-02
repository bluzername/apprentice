import type { Rect } from "@apprentice/schemas";
import {
  BROWSER_CHROME_HEIGHT,
  COLORS,
  browserChrome,
  button,
  card,
  inputField,
  line,
  page,
  paragraphLines,
  sidebar,
  text
} from "./primitives.js";
import { resolveVariant, type ScreenTemplate } from "./template.js";

const NAV = ["Inbox", "Starred", "Sent", "Drafts", "Archive"];
const SEND: Rect = { x: 300, y: 800, width: 120, height: 40 };
const DOWNLOAD: Rect = { x: 300, y: 720, width: 150, height: 40 };

export const mailCompose: ScreenTemplate = {
  name: "mailCompose",
  primaryLabel: "Send",
  primaryButton: SEND,
  render: (variant) => {
    const v = resolveVariant(variant, { title: "New message", primaryLabel: "Send" });
    const top = BROWSER_CHROME_HEIGHT;
    const body = [
      browserChrome("https://mail.example/compose", "Compose - Mail"),
      sidebar(220, top, NAV, 3),
      text(260, top + 60, v.title, 26, COLORS.ink, 'font-weight="600"'),
      card({ x: 260, y: top + 90, width: 1100, height: 690 }),
      inputField(300, top + 140, 1020, "To", "jordan@acme.example"),
      inputField(300, top + 210, 1020, "Subject", "Follow-up: next steps after today's meeting"),
      text(300, top + 272, "Body", 12, COLORS.muted),
      `<rect x="300" y="${top + 280}" width="1020" height="380" rx="5" fill="${COLORS.surface}" stroke="${COLORS.border}"/>`,
      text(316, top + 312, "Hi Jordan,", 14),
      paragraphLines(316, top + 334, 960, 8),
      text(316, top + 540, "Best regards", 14),
      button({ x: 440, y: 800, width: 120, height: 40 }, "Discard", false),
      button(SEND, v.primaryLabel)
    ].join("");
    return page(body, v.highlight);
  }
};

export const invoiceEmail: ScreenTemplate = {
  name: "invoiceEmail",
  primaryLabel: "Download",
  primaryButton: DOWNLOAD,
  render: (variant) => {
    const v = resolveVariant(variant, { title: "Invoice INV-2041 from Acme Ltd", primaryLabel: "Download" });
    const top = BROWSER_CHROME_HEIGHT;
    const body = [
      browserChrome("https://mail.example/inbox/3c9d1e7f2a4b", "Inbox - Mail"),
      sidebar(220, top, NAV, 0),
      text(260, top + 60, v.title, 24, COLORS.ink, 'font-weight="600"'),
      text(260, top + 88, "billing@acme.example  -  to you  -  09:42", 13, COLORS.muted),
      card({ x: 260, y: top + 110, width: 1100, height: 560 }),
      text(300, top + 150, "Hello,", 14),
      text(300, top + 176, "Please find attached invoice INV-2041 for services rendered in August.", 14),
      text(300, top + 200, "Amount due: 4,250.00  -  Due date: 30 September", 14),
      paragraphLines(300, top + 228, 1000, 5),
      line(300, top + 372, 1320, top + 372),
      text(300, top + 402, "Attachments (1)", 14, COLORS.ink, 'font-weight="600"'),
      `<rect x="300" y="${top + 420}" width="360" height="72" rx="6" fill="${COLORS.page}" stroke="${COLORS.border}"/>`,
      `<rect x="316" y="${top + 436}" width="32" height="40" rx="3" fill="#dc2626"/>`,
      text(324, top + 462, "PDF", 10, COLORS.accentInk),
      text(362, top + 452, "INV-2041-acme.pdf", 14),
      text(362, top + 472, "84 KB", 12, COLORS.muted),
      button(DOWNLOAD, v.primaryLabel),
      button({ x: 470, y: 720, width: 120, height: 40 }, "Preview", false)
    ].join("");
    return page(body, v.highlight);
  }
};
