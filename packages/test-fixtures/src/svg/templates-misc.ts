import type { Rect } from "@apprentice/schemas";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../types.js";
import { BROWSER_CHROME_HEIGHT, COLORS, browserChrome, button, card, page, paragraphLines, rect, text } from "./primitives.js";
import { resolveVariant, type ScreenTemplate } from "./template.js";

const READ_MORE: Rect = { x: 300, y: 500, width: 140, height: 40 };
const BLANK_PRIMARY: Rect = { x: 640, y: 430, width: 160, height: 40 };

export const newsFeed: ScreenTemplate = {
  name: "newsFeed",
  primaryLabel: "Read more",
  primaryButton: READ_MORE,
  render: (variant) => {
    const v = resolveVariant(variant, { title: "Front page", primaryLabel: "Read more" });
    const top = BROWSER_CHROME_HEIGHT;
    const stories = Array.from({ length: 3 }, (_, index) => {
      const y = top + 560 + index * 90;
      return [
        `<rect x="260" y="${y}" width="120" height="70" rx="6" fill="${COLORS.chromeDark}"/>`,
        text(400, y + 22, `Story headline placeholder ${index + 2}`, 16, COLORS.ink, 'font-weight="600"'),
        paragraphLines(400, y + 36, 700, 2, 18)
      ].join("");
    });
    const body = [
      browserChrome("https://news.example/", "News"),
      rect({ x: 0, y: top, width: SCREEN_WIDTH, height: 60 }, COLORS.surface),
      text(260, top + 38, v.title, 22, COLORS.ink, 'font-weight="700"'),
      ...["World", "Business", "Technology", "Culture", "Sport"].map((section, index) =>
        text(560 + index * 120, top + 38, section, 14, COLORS.muted)
      ),
      card({ x: 260, y: top + 90, width: 800, height: 440 }),
      `<rect x="280" y="${top + 110}" width="760" height="220" rx="6" fill="${COLORS.chromeDark}"/>`,
      text(280, top + 370, "Lead story headline placeholder", 24, COLORS.ink, 'font-weight="700"'),
      paragraphLines(280, top + 392, 740, 3),
      button(READ_MORE, v.primaryLabel),
      card({ x: 1080, y: top + 90, width: 280, height: 440 }),
      text(1100, top + 122, "Most read", 16, COLORS.ink, 'font-weight="600"'),
      paragraphLines(1100, top + 150, 240, 12, 30),
      ...stories
    ].join("");
    return page(body, v.highlight);
  }
};

export const genericBlank: ScreenTemplate = {
  name: "genericBlank",
  primaryLabel: "Continue",
  primaryButton: BLANK_PRIMARY,
  render: (variant) => {
    const v = resolveVariant(variant, { title: "Untitled page", primaryLabel: "Continue" });
    const body = [
      browserChrome("https://example.invalid/", "New tab"),
      rect({ x: 0, y: BROWSER_CHROME_HEIGHT, width: SCREEN_WIDTH, height: SCREEN_HEIGHT - BROWSER_CHROME_HEIGHT }, COLORS.surface),
      text(SCREEN_WIDTH / 2, 380, v.title, 24, COLORS.muted, 'text-anchor="middle"'),
      button(BLANK_PRIMARY, v.primaryLabel)
    ].join("");
    return page(body, v.highlight);
  }
};
