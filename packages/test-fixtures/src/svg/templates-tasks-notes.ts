import type { Rect } from "@apprentice/schemas";
import {
  BROWSER_CHROME_HEIGHT,
  COLORS,
  browserChrome,
  button,
  card,
  page,
  paragraphLines,
  sidebar,
  text
} from "./primitives.js";
import { resolveVariant, type ScreenTemplate } from "./template.js";

const NEW_TASK: Rect = { x: 1200, y: 132, width: 160, height: 40 };
const NOTES_SHARE: Rect = { x: 1220, y: 132, width: 140, height: 40 };

function column(x: number, title: string, count: number): string {
  const top = BROWSER_CHROME_HEIGHT + 120;
  const cards = Array.from({ length: count }, (_, index) => {
    const y = top + 50 + index * 96;
    return [card({ x: x + 12, y, width: 316, height: 80 }), paragraphLines(x + 28, y + 20, 280, 2, 20)].join("");
  });
  return [
    `<rect x="${x}" y="${top}" width="340" height="620" rx="8" fill="${COLORS.chrome}"/>`,
    text(x + 16, top + 30, `${title}  (${count})`, 14, COLORS.ink, 'font-weight="600"'),
    ...cards
  ].join("");
}

export const taskBoard: ScreenTemplate = {
  name: "taskBoard",
  primaryLabel: "New task",
  primaryButton: NEW_TASK,
  render: (variant) => {
    const v = resolveVariant(variant, { title: "Customer follow-ups", primaryLabel: "New task" });
    const top = BROWSER_CHROME_HEIGHT;
    const body = [
      browserChrome("https://tasks.example/board/5a1f2c", "Board - Tasks"),
      sidebar(220, top, ["Boards", "My tasks", "Calendar", "Reports"], 0),
      text(260, top + 60, v.title, 26, COLORS.ink, 'font-weight="600"'),
      text(260, top + 88, "Board  -  12 open tasks", 14, COLORS.muted),
      button(NEW_TASK, v.primaryLabel),
      column(260, "To do", 4),
      column(620, "In progress", 3),
      column(980, "Done", 5)
    ].join("");
    return page(body, v.highlight);
  }
};

export const notesPage: ScreenTemplate = {
  name: "notesPage",
  primaryLabel: "Share",
  primaryButton: NOTES_SHARE,
  render: (variant) => {
    const v = resolveVariant(variant, { title: "Meeting notes - Acme Ltd sync", primaryLabel: "Share" });
    const top = BROWSER_CHROME_HEIGHT;
    const body = [
      browserChrome("https://notes.example/meeting/7b3e9a1d", "Notes"),
      sidebar(220, top, ["All notes", "Meetings", "Projects", "Archive"], 1),
      text(260, top + 60, v.title, 26, COLORS.ink, 'font-weight="600"'),
      text(260, top + 88, "Today  -  45 min  -  3 attendees", 14, COLORS.muted),
      button(NOTES_SHARE, v.primaryLabel),
      card({ x: 260, y: top + 120, width: 1100, height: 660 }),
      text(300, top + 160, "Summary", 18, COLORS.ink, 'font-weight="600"'),
      paragraphLines(300, top + 184, 1020, 5),
      text(300, top + 320, "Decisions", 18, COLORS.ink, 'font-weight="600"'),
      paragraphLines(300, top + 344, 1020, 3),
      text(300, top + 440, "Action items", 18, COLORS.ink, 'font-weight="600"'),
      `<rect x="300" y="${top + 462}" width="14" height="14" rx="3" fill="none" stroke="${COLORS.border}"/>`,
      text(324, top + 474, "Send proposal revision to Jordan Rivera", 14),
      `<rect x="300" y="${top + 492}" width="14" height="14" rx="3" fill="none" stroke="${COLORS.border}"/>`,
      text(324, top + 504, "Log the meeting in the CRM", 14),
      `<rect x="300" y="${top + 522}" width="14" height="14" rx="3" fill="none" stroke="${COLORS.border}"/>`,
      text(324, top + 534, "Create a task for the contract review", 14)
    ].join("");
    return page(body, v.highlight);
  }
};
