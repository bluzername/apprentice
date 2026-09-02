import { Resvg } from "@resvg/resvg-js";
import { SCREEN_HEIGHT, SCREEN_WIDTH, TEMPLATE_NAMES, type TemplateName } from "../types.js";
import { crmContact, crmLogActivity } from "./templates-crm.js";
import { invoiceEmail, mailCompose } from "./templates-mail.js";
import { notesPage, taskBoard } from "./templates-tasks-notes.js";
import { finderWindow, previewPdf } from "./templates-native.js";
import { accountingUpload, chatMessage } from "./templates-accounting-chat.js";
import { atsCandidate, atsStatusDialog, calendarSchedule } from "./templates-ats-calendar.js";
import { genericBlank, newsFeed } from "./templates-misc.js";
import { centre, type ScreenTemplate, type TemplateVariant } from "./template.js";

export type { ScreenTemplate, TemplateVariant } from "./template.js";
export { COLORS } from "./primitives.js";

export const SCREEN_TEMPLATES: Readonly<Record<TemplateName, ScreenTemplate>> = {
  crmContact,
  crmLogActivity,
  mailCompose,
  taskBoard,
  notesPage,
  invoiceEmail,
  finderWindow,
  previewPdf,
  accountingUpload,
  atsCandidate,
  atsStatusDialog,
  calendarSchedule,
  chatMessage,
  newsFeed,
  genericBlank
};

export interface TemplateTarget {
  readonly label: string;
  readonly x: number;
  readonly y: number;
}

/** Pixel centre of the primary action button in each default render. */
export const TARGETS: Readonly<Record<TemplateName, TemplateTarget>> = Object.fromEntries(
  TEMPLATE_NAMES.map((name) => {
    const template = SCREEN_TEMPLATES[name];
    return [name, { label: template.primaryLabel, ...centre(template.primaryButton) }];
  })
) as Record<TemplateName, TemplateTarget>;

export function isTemplateName(value: string): value is TemplateName {
  return (TEMPLATE_NAMES as readonly string[]).includes(value);
}

export function renderTemplateSvg(name: TemplateName, variant?: TemplateVariant): string {
  return SCREEN_TEMPLATES[name].render(variant);
}

/** Rasterizes an SVG string to a 1440x900 PNG using resvg with system fonts. */
export function renderSvgToPng(svg: string): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: SCREEN_WIDTH },
    font: { loadSystemFonts: true, defaultFontFamily: "Helvetica" },
    background: "#ffffff"
  });
  const rendered = resvg.render();
  if (rendered.width !== SCREEN_WIDTH || rendered.height !== SCREEN_HEIGHT) {
    throw new Error(`renderSvgToPng: expected ${SCREEN_WIDTH}x${SCREEN_HEIGHT}, got ${rendered.width}x${rendered.height}`);
  }
  return rendered.asPng();
}

export function renderTemplatePng(name: TemplateName, variant?: TemplateVariant): Buffer {
  return renderSvgToPng(renderTemplateSvg(name, variant));
}
