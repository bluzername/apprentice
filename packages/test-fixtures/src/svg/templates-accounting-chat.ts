import type { Rect } from "@apprentice/schemas";
import { SCREEN_HEIGHT } from "../types.js";
import {
  BROWSER_CHROME_HEIGHT,
  COLORS,
  browserChrome,
  button,
  card,
  inputField,
  page,
  paragraphLines,
  sidebar,
  text
} from "./primitives.js";
import { resolveVariant, type ScreenTemplate } from "./template.js";

const UPLOAD: Rect = { x: 300, y: 300, width: 160, height: 40 };
const SEND_MESSAGE: Rect = { x: 1240, y: 812, width: 120, height: 40 };

export const accountingUpload: ScreenTemplate = {
  name: "accountingUpload",
  primaryLabel: "Upload",
  primaryButton: UPLOAD,
  render: (variant) => {
    const v = resolveVariant(variant, { title: "New bill", primaryLabel: "Upload" });
    const top = BROWSER_CHROME_HEIGHT;
    const body = [
      browserChrome("https://accounting.example/bills/new", "Bills - Accounting"),
      sidebar(220, top, ["Dashboard", "Bills", "Invoices", "Expenses", "Reports"], 1),
      text(260, top + 60, v.title, 26, COLORS.ink, 'font-weight="600"'),
      text(260, top + 88, "Attach the supplier PDF and confirm the details", 14, COLORS.muted),
      card({ x: 260, y: top + 110, width: 1100, height: 660 }),
      `<rect x="300" y="${top + 150}" width="1020" height="120" rx="8" fill="${COLORS.page}" stroke="${COLORS.border}" stroke-dasharray="6 4"/>`,
      text(810, top + 200, "Drop a PDF here or use the button below", 14, COLORS.muted, 'text-anchor="middle"'),
      button(UPLOAD, v.primaryLabel),
      inputField(300, top + 300, 480, "Supplier", "Acme Ltd"),
      inputField(840, top + 300, 480, "Bill number", "INV-2041"),
      inputField(300, top + 380, 480, "Amount", "4,250.00"),
      inputField(840, top + 380, 480, "Due date", "2026-09-30"),
      inputField(300, top + 460, 1020, "Category", "Professional services"),
      button({ x: 1200, y: 720, width: 120, height: 40 }, "Save bill"),
      button({ x: 1060, y: 720, width: 120, height: 40 }, "Cancel", false)
    ].join("");
    return page(body, v.highlight);
  }
};

export const chatMessage: ScreenTemplate = {
  name: "chatMessage",
  primaryLabel: "Send",
  primaryButton: SEND_MESSAGE,
  render: (variant) => {
    const v = resolveVariant(variant, { title: "# finance", primaryLabel: "Send" });
    const top = BROWSER_CHROME_HEIGHT;
    const messages = ["Sam Okafor", "Priya Natarajan", "You", "Sam Okafor"].map((author, index) => {
      const y = top + 140 + index * 120;
      return [
        `<circle cx="300" cy="${y}" r="18" fill="${COLORS.chromeDark}"/>`,
        text(332, y - 4, author, 14, COLORS.ink, 'font-weight="600"'),
        text(332 + author.length * 9 + 12, y - 4, "10:1" + String(index), 12, COLORS.muted),
        paragraphLines(332, y + 12, 900, 2, 20)
      ].join("");
    });
    const body = [
      browserChrome("https://chat.example/channel/9d4e1a", "Chat"),
      sidebar(220, top, ["# general", "# finance", "# ops", "Direct messages"], 1),
      text(260, top + 60, v.title, 24, COLORS.ink, 'font-weight="600"'),
      text(260, top + 88, "Invoices, bills, and payment questions", 14, COLORS.muted),
      ...messages,
      `<rect x="260" y="${SCREEN_HEIGHT - 100}" width="1100" height="60" rx="8" fill="${COLORS.surface}" stroke="${COLORS.border}"/>`,
      text(280, SCREEN_HEIGHT - 64, "Filed INV-2041 from Acme Ltd, due 30 Sep, uploaded to accounting.", 14),
      button(SEND_MESSAGE, v.primaryLabel)
    ].join("");
    return page(body, v.highlight);
  }
};
