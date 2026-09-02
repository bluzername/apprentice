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

const CHANGE_STATUS: Rect = { x: 1180, y: 132, width: 180, height: 40 };
const UPDATE_STATUS: Rect = { x: 880, y: 560, width: 120, height: 40 };
const SCHEDULE: Rect = { x: 1200, y: 132, width: 160, height: 40 };

function candidateBody(title: string, primaryLabel: string): string {
  const top = BROWSER_CHROME_HEIGHT;
  const tabs = ["Overview", "Resume", "Interviews", "Notes"];
  return [
    browserChrome("https://ats.example/candidates/4d7e2b9c1a3f", "Candidates - ATS"),
    sidebar(220, top, ["Jobs", "Candidates", "Interviews", "Reports"], 1),
    text(260, top + 60, title, 26, COLORS.ink, 'font-weight="600"'),
    text(260, top + 88, "Senior Operations Analyst  -  Stage: Phone screen", 14, COLORS.muted),
    button(CHANGE_STATUS, primaryLabel),
    ...tabs.map((tab, index) =>
      text(260 + index * 120, top + 140, tab, 14, index === 1 ? COLORS.accent : COLORS.muted, 'font-weight="600"')
    ),
    line(260, top + 152, 1360, top + 152),
    `<rect x="${260 + 120}" y="${top + 150}" width="60" height="3" fill="${COLORS.accent}"/>`,
    card({ x: 260, y: top + 180, width: 720, height: 600 }),
    text(300, top + 220, "Resume", 18, COLORS.ink, 'font-weight="600"'),
    paragraphLines(300, top + 248, 640, 6),
    text(300, top + 400, "Experience", 16, COLORS.ink, 'font-weight="600"'),
    paragraphLines(300, top + 424, 640, 8),
    card({ x: 1000, y: top + 180, width: 360, height: 600 }),
    text(1020, top + 220, "Scorecard", 18, COLORS.ink, 'font-weight="600"'),
    paragraphLines(1020, top + 248, 320, 10)
  ].join("");
}

export const atsCandidate: ScreenTemplate = {
  name: "atsCandidate",
  primaryLabel: "Change status",
  primaryButton: CHANGE_STATUS,
  render: (variant) => {
    const v = resolveVariant(variant, { title: "Jordan Rivera", primaryLabel: "Change status" });
    return page(candidateBody(v.title, v.primaryLabel), v.highlight);
  }
};

export const atsStatusDialog: ScreenTemplate = {
  name: "atsStatusDialog",
  primaryLabel: "Update",
  primaryButton: UPDATE_STATUS,
  render: (variant) => {
    const v = resolveVariant(variant, { title: "Change status", primaryLabel: "Update" });
    const body = [
      candidateBody("Jordan Rivera", "Change status"),
      modalBackdrop(),
      card({ x: 420, y: 220, width: 600, height: 400 }),
      text(444, 262, v.title, 20, COLORS.ink, 'font-weight="600"'),
      text(444, 286, "Jordan Rivera  -  Senior Operations Analyst", 13, COLORS.muted),
      inputField(444, 330, 552, "Status", "Interview"),
      inputField(444, 400, 552, "Reason", "Strong phone screen"),
      text(444, 470, "The candidate will be notified by email.", 13, COLORS.muted),
      button({ x: 740, y: 560, width: 120, height: 40 }, "Cancel", false),
      button(UPDATE_STATUS, v.primaryLabel)
    ].join("");
    return page(body, v.highlight);
  }
};

export const calendarSchedule: ScreenTemplate = {
  name: "calendarSchedule",
  primaryLabel: "Schedule",
  primaryButton: SCHEDULE,
  render: (variant) => {
    const v = resolveVariant(variant, { title: "Schedule interview", primaryLabel: "Schedule" });
    const top = BROWSER_CHROME_HEIGHT;
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
    const grid = days.flatMap((day, dayIndex) => {
      const x = 260 + dayIndex * 220;
      const rows = Array.from({ length: 9 }, (_, hour) => line(x, top + 220 + hour * 60, x + 220, top + 220 + hour * 60));
      return [text(x + 8, top + 206, day, 13, COLORS.muted), ...rows];
    });
    const body = [
      browserChrome("https://calendar.example/schedule", "Calendar"),
      sidebar(220, top, ["Week", "Month", "Interviews", "Rooms"], 2),
      text(260, top + 60, v.title, 26, COLORS.ink, 'font-weight="600"'),
      text(260, top + 88, "Week of 7 September", 14, COLORS.muted),
      button(SCHEDULE, v.primaryLabel),
      card({ x: 260, y: top + 180, width: 1100, height: 600 }),
      ...grid,
      `<rect x="704" y="${top + 340}" width="212" height="58" rx="6" fill="#dbe7ff" stroke="${COLORS.accent}"/>`,
      text(712, top + 362, "Interview - Jordan Rivera", 12, COLORS.ink, 'font-weight="600"'),
      text(712, top + 380, "11:00 - 12:00", 12, COLORS.muted)
    ].join("");
    return page(body, v.highlight);
  }
};
