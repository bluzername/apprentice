import type { Rect } from "@apprentice/schemas";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../types.js";
import { COLORS, MAC_TITLE_HEIGHT, button, line, macWindowChrome, page, paragraphLines, rect, text } from "./primitives.js";
import { resolveVariant, type ScreenTemplate } from "./template.js";

const FINDER_MOVE: Rect = { x: 1240, y: 820, width: 160, height: 40 };
const PREVIEW_SAVE: Rect = { x: 1020, y: 560, width: 120, height: 40 };

const FILES = [
  ["INV-2041-acme.pdf", "PDF document", "84 KB", "Today, 09:44"],
  ["quarterly-plan.key", "Keynote", "3.2 MB", "Yesterday"],
  ["logo-draft.png", "PNG image", "412 KB", "Monday"],
  ["notes-export.txt", "Plain text", "6 KB", "Last week"]
] as const;

export const finderWindow: ScreenTemplate = {
  name: "finderWindow",
  primaryLabel: "Move to",
  primaryButton: FINDER_MOVE,
  render: (variant) => {
    const v = resolveVariant(variant, { title: "Downloads", primaryLabel: "Move to" });
    const top = MAC_TITLE_HEIGHT;
    const sidebarItems = ["Recents", "Downloads", "Documents", "Invoices", "Desktop"];
    const rows = FILES.map(([name, kind, size, date], index) => {
      const y = top + 90 + index * 36;
      const selected = index === 0;
      return [
        selected ? rect({ x: 220, y: y - 24, width: SCREEN_WIDTH - 220, height: 34 }, "#dbe7ff") : "",
        text(248, y, name, 14),
        text(720, y, kind, 13, COLORS.muted),
        text(960, y, size, 13, COLORS.muted),
        text(1120, y, date, 13, COLORS.muted)
      ].join("");
    });
    const body = [
      macWindowChrome(v.title),
      rect({ x: 0, y: top, width: 220, height: SCREEN_HEIGHT - top }, COLORS.page),
      line(220, top, 220, SCREEN_HEIGHT),
      ...sidebarItems.map((item, index) => text(28, top + 40 + index * 34, item, 14, index === 1 ? COLORS.ink : COLORS.muted)),
      text(248, top + 40, "Name", 12, COLORS.muted),
      text(720, top + 40, "Kind", 12, COLORS.muted),
      text(960, top + 40, "Size", 12, COLORS.muted),
      text(1120, top + 40, "Date modified", 12, COLORS.muted),
      line(220, top + 52, SCREEN_WIDTH, top + 52),
      ...rows,
      button(FINDER_MOVE, v.primaryLabel)
    ].join("");
    return page(body, v.highlight);
  }
};

export const previewPdf: ScreenTemplate = {
  name: "previewPdf",
  primaryLabel: "Save",
  primaryButton: PREVIEW_SAVE,
  render: (variant) => {
    const v = resolveVariant(variant, { title: "INV-2041-acme.pdf", primaryLabel: "Save" });
    const top = MAC_TITLE_HEIGHT;
    const sheet: Rect = { x: 380, y: 140, width: 780, height: 480 };
    const body = [
      macWindowChrome(v.title),
      rect({ x: 0, y: top, width: SCREEN_WIDTH, height: SCREEN_HEIGHT - top }, "#8e9199"),
      rect({ x: 360, y: top + 40, width: 720, height: 760 }, COLORS.surface),
      text(400, top + 100, "INVOICE", 28, COLORS.ink, 'font-weight="700"'),
      text(400, top + 130, "Acme Ltd  -  INV-2041", 14, COLORS.muted),
      paragraphLines(400, top + 170, 640, 4),
      text(400, top + 300, "Total due: 4,250.00", 16, COLORS.ink, 'font-weight="600"'),
      paragraphLines(400, top + 330, 640, 6),
      `<rect x="${sheet.x}" y="${sheet.y}" width="${sheet.width}" height="${sheet.height}" rx="10" fill="${COLORS.page}" stroke="${COLORS.border}"/>`,
      text(420, 190, "Save As:", 14, COLORS.muted),
      `<rect x="500" y="170" width="620" height="32" rx="5" fill="${COLORS.surface}" stroke="${COLORS.border}"/>`,
      text(512, 191, "2026-09-01_acme_INV-2041.pdf", 14),
      text(420, 250, "Tags:", 14, COLORS.muted),
      `<rect x="500" y="230" width="620" height="32" rx="5" fill="${COLORS.surface}" stroke="${COLORS.border}"/>`,
      text(420, 310, "Where:", 14, COLORS.muted),
      `<rect x="500" y="290" width="620" height="32" rx="5" fill="${COLORS.surface}" stroke="${COLORS.border}"/>`,
      text(512, 311, "Downloads", 14),
      text(420, 370, "Format:", 14, COLORS.muted),
      `<rect x="500" y="350" width="620" height="32" rx="5" fill="${COLORS.surface}" stroke="${COLORS.border}"/>`,
      text(512, 371, "PDF", 14),
      button({ x: 880, y: 560, width: 120, height: 40 }, "Cancel", false),
      button(PREVIEW_SAVE, v.primaryLabel)
    ].join("");
    return page(body, v.highlight);
  }
};
