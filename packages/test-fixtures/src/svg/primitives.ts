import type { Rect } from "@apprentice/schemas";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../types.js";

export const FONT = "Helvetica Neue, Helvetica, Arial, sans-serif";
export const COLORS = {
  page: "#f4f5f7",
  surface: "#ffffff",
  chrome: "#e6e8ec",
  chromeDark: "#d7dae0",
  border: "#d0d4db",
  ink: "#1f2430",
  muted: "#6b7280",
  accent: "#2563eb",
  accentInk: "#ffffff",
  highlight: "#f59e0b",
  success: "#16a34a"
} as const;

export const BROWSER_CHROME_HEIGHT = 88;
export const MAC_TITLE_HEIGHT = 52;

export function esc(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function rect(r: Rect, fill: string, extra = ""): string {
  return `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" fill="${fill}" ${extra}/>`;
}

export function text(x: number, y: number, content: string, size = 14, fill: string = COLORS.ink, extra = ""): string {
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" fill="${fill}" ${extra}>${esc(content)}</text>`;
}

export function line(x1: number, y1: number, x2: number, y2: number, stroke: string = COLORS.border): string {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="1"/>`;
}

export function button(r: Rect, label: string, primary = true): string {
  const fill = primary ? COLORS.accent : COLORS.surface;
  const ink = primary ? COLORS.accentInk : COLORS.ink;
  const stroke = primary ? "" : `stroke="${COLORS.border}"`;
  return [
    `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="6" fill="${fill}" ${stroke}/>`,
    text(r.x + r.width / 2, r.y + r.height / 2 + 5, label, 15, ink, 'text-anchor="middle" font-weight="600"')
  ].join("");
}

export function inputField(x: number, y: number, width: number, label: string, value = "", height = 36): string {
  return [
    text(x, y - 8, label, 12, COLORS.muted),
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="5" fill="${COLORS.surface}" stroke="${COLORS.border}"/>`,
    value ? text(x + 12, y + height / 2 + 5, value, 14) : ""
  ].join("");
}

export function card(r: Rect): string {
  return `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="8" fill="${COLORS.surface}" stroke="${COLORS.border}"/>`;
}

export function paragraphLines(x: number, y: number, width: number, count: number, gap = 22): string {
  return Array.from({ length: count }, (_, index) => {
    const w = index === count - 1 ? width * 0.55 : width;
    return `<rect x="${x}" y="${y + index * gap}" width="${w}" height="10" rx="5" fill="${COLORS.chrome}"/>`;
  }).join("");
}

export function highlightRing(r: Rect): string {
  return `<rect x="${r.x - 6}" y="${r.y - 6}" width="${r.width + 12}" height="${r.height + 12}" rx="10" fill="none" stroke="${COLORS.highlight}" stroke-width="4"/>`;
}

/** Generic browser frame: tab strip, address bar, then a page area starting at BROWSER_CHROME_HEIGHT. */
export function browserChrome(url: string, tabTitle: string): string {
  return [
    rect({ x: 0, y: 0, width: SCREEN_WIDTH, height: 40 }, COLORS.chromeDark),
    `<circle cx="20" cy="20" r="6" fill="#ff5f57"/><circle cx="40" cy="20" r="6" fill="#febc2e"/><circle cx="60" cy="20" r="6" fill="#28c840"/>`,
    `<rect x="90" y="8" width="240" height="32" rx="8" fill="${COLORS.chrome}"/>`,
    text(104, 29, tabTitle, 13),
    rect({ x: 0, y: 40, width: SCREEN_WIDTH, height: 48 }, COLORS.chrome),
    `<rect x="120" y="50" width="${SCREEN_WIDTH - 240}" height="28" rx="14" fill="${COLORS.surface}" stroke="${COLORS.border}"/>`,
    text(136, 69, url, 13, COLORS.muted),
    line(0, BROWSER_CHROME_HEIGHT, SCREEN_WIDTH, BROWSER_CHROME_HEIGHT)
  ].join("");
}

/** Generic native window frame with traffic lights and a centered title. */
export function macWindowChrome(title: string): string {
  return [
    rect({ x: 0, y: 0, width: SCREEN_WIDTH, height: MAC_TITLE_HEIGHT }, COLORS.chrome),
    `<circle cx="20" cy="26" r="6" fill="#ff5f57"/><circle cx="40" cy="26" r="6" fill="#febc2e"/><circle cx="60" cy="26" r="6" fill="#28c840"/>`,
    text(SCREEN_WIDTH / 2, 31, title, 14, COLORS.ink, 'text-anchor="middle" font-weight="600"'),
    line(0, MAC_TITLE_HEIGHT, SCREEN_WIDTH, MAC_TITLE_HEIGHT)
  ].join("");
}

export function sidebar(width: number, top: number, items: readonly string[], activeIndex = 0): string {
  const rows = items.map((item, index) => {
    const y = top + 24 + index * 40;
    const active = index === activeIndex;
    return [
      active ? `<rect x="12" y="${y - 22}" width="${width - 24}" height="32" rx="6" fill="${COLORS.chrome}"/>` : "",
      text(28, y, item, 14, active ? COLORS.ink : COLORS.muted)
    ].join("");
  });
  return [
    rect({ x: 0, y: top, width, height: SCREEN_HEIGHT - top }, COLORS.page),
    line(width, top, width, SCREEN_HEIGHT),
    ...rows
  ].join("");
}

export function page(body: string, highlight?: Rect): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SCREEN_WIDTH}" height="${SCREEN_HEIGHT}" viewBox="0 0 ${SCREEN_WIDTH} ${SCREEN_HEIGHT}">`,
    rect({ x: 0, y: 0, width: SCREEN_WIDTH, height: SCREEN_HEIGHT }, COLORS.page),
    body,
    highlight ? highlightRing(highlight) : "",
    "</svg>"
  ].join("");
}

export function modalBackdrop(): string {
  return `<rect x="0" y="0" width="${SCREEN_WIDTH}" height="${SCREEN_HEIGHT}" fill="#000000" fill-opacity="0.35"/>`;
}
