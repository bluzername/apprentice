/**
 * Semantic element descriptors. Works on a minimal `ElementLike` interface so
 * the logic is testable without a DOM, and so it can never read input values.
 */
import type { SemanticElement } from "@apprentice/schemas";
import { FINGERPRINT_MAX_DEPTH, MAX_TEXT_LENGTH } from "../shared/constants.js";
import { shortHash } from "../shared/hash.js";

export interface ElementLike {
  readonly tagName: string;
  readonly id: string;
  readonly parentElement: ElementLike | null;
  readonly children: ArrayLike<ElementLike>;
  readonly textContent: string | null;
  readonly innerText?: string;
  readonly labels?: ArrayLike<ElementLike> | null;
  getAttribute(name: string): string | null;
}

export interface DomLookup {
  byId(id: string): ElementLike | null;
}

export const NO_LOOKUP: DomLookup = { byId: () => null };

const INPUT_ROLES: Readonly<Record<string, string>> = {
  button: "button",
  submit: "button",
  reset: "button",
  image: "button",
  checkbox: "checkbox",
  radio: "radio",
  range: "slider",
  search: "searchbox",
  number: "spinbutton",
  file: "button"
};

const TAG_ROLES: Readonly<Record<string, string>> = {
  button: "button",
  textarea: "textbox",
  select: "combobox",
  option: "option",
  img: "img",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  nav: "navigation",
  main: "main",
  form: "form",
  ul: "list",
  ol: "list",
  li: "listitem",
  table: "table",
  tr: "row",
  td: "cell",
  th: "columnheader",
  summary: "button",
  details: "group",
  dialog: "dialog",
  hr: "separator",
  progress: "progressbar",
  meter: "meter",
  header: "banner",
  footer: "contentinfo",
  aside: "complementary",
  section: "region",
  article: "article"
};

const TEXTLESS_TAGS: ReadonlySet<string> = new Set(["input", "textarea", "select", "option"]);
const INTERACTIVE_TAGS: ReadonlySet<string> = new Set(["a", "button", "input", "select", "textarea", "summary", "label"]);

function tag(element: ElementLike): string {
  return element.tagName.toLowerCase();
}

function collapse(text: string | null | undefined, max: number): string | undefined {
  if (!text) {
    return undefined;
  }
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length === 0 ? undefined : cleaned.slice(0, max);
}

/** Explicit `role` attribute wins; otherwise the implicit ARIA role for the tag. */
export function elementRole(element: ElementLike): string | undefined {
  const explicit = collapse(element.getAttribute("role"), 64);
  if (explicit) {
    return explicit.split(" ")[0];
  }
  const name = tag(element);
  if (name === "a") {
    return element.getAttribute("href") !== null ? "link" : undefined;
  }
  if (name === "input") {
    const type = (element.getAttribute("type") ?? "text").toLowerCase();
    return INPUT_ROLES[type] ?? "textbox";
  }
  return TAG_ROLES[name];
}

function labelledByText(element: ElementLike, lookup: DomLookup): string | undefined {
  const ids = element.getAttribute("aria-labelledby");
  if (!ids) {
    return undefined;
  }
  const parts = ids
    .split(/\s+/)
    .map((id) => lookup.byId(id))
    .map((target) => (target ? collapse(target.innerText ?? target.textContent, MAX_TEXT_LENGTH) : undefined))
    .filter((part): part is string => part !== undefined);
  return parts.length > 0 ? parts.join(" ").slice(0, MAX_TEXT_LENGTH) : undefined;
}

function labelText(element: ElementLike): string | undefined {
  const labels = element.labels;
  if (!labels || labels.length === 0) {
    return undefined;
  }
  const first = labels[0];
  return first ? collapse(first.innerText ?? first.textContent, MAX_TEXT_LENGTH) : undefined;
}

/** Short visible text. Never derived from form controls, whose text content can hold user input. */
export function visibleText(element: ElementLike): string | undefined {
  if (TEXTLESS_TAGS.has(tag(element))) {
    return undefined;
  }
  return collapse(element.innerText ?? element.textContent, MAX_TEXT_LENGTH);
}

/** Accessible name approximation: aria-labelledby, aria-label, associated label, title, alt, button value, text. */
export function accessibleName(element: ElementLike, lookup: DomLookup = NO_LOOKUP): string | undefined {
  const fromLabelledBy = labelledByText(element, lookup);
  if (fromLabelledBy) {
    return fromLabelledBy;
  }
  const ariaLabel = collapse(element.getAttribute("aria-label"), MAX_TEXT_LENGTH);
  if (ariaLabel) {
    return ariaLabel;
  }
  const fromLabel = labelText(element);
  if (fromLabel) {
    return fromLabel;
  }
  const title = collapse(element.getAttribute("title"), MAX_TEXT_LENGTH);
  if (title) {
    return title;
  }
  const alt = collapse(element.getAttribute("alt"), MAX_TEXT_LENGTH);
  if (alt) {
    return alt;
  }
  if (tag(element) === "input") {
    const type = (element.getAttribute("type") ?? "text").toLowerCase();
    if (type === "submit" || type === "button" || type === "reset") {
      const value = collapse(element.getAttribute("value"), MAX_TEXT_LENGTH);
      if (value) {
        return value;
      }
    }
    return collapse(element.getAttribute("placeholder"), MAX_TEXT_LENGTH);
  }
  return visibleText(element);
}

function indexInParent(element: ElementLike): number {
  const parent = element.parentElement;
  if (parent === null) {
    return 0;
  }
  const siblings = parent.children;
  for (let index = 0; index < siblings.length; index += 1) {
    if (siblings[index] === element) {
      return index;
    }
  }
  return 0;
}

/** nth-child path from the element upward, capped at FINGERPRINT_MAX_DEPTH levels. */
export function structuralPath(element: ElementLike, maxDepth: number = FINGERPRINT_MAX_DEPTH): string {
  const segments: string[] = [];
  let current: ElementLike | null = element;
  while (current !== null && segments.length < maxDepth) {
    segments.unshift(`${tag(current)}:${indexInParent(current)}`);
    current = current.parentElement;
  }
  return segments.join(">");
}

export function elementIdentifier(element: ElementLike): string | undefined {
  const candidates = [element.id, element.getAttribute("name"), element.getAttribute("data-testid")];
  const found = candidates.find((value) => typeof value === "string" && value.trim().length > 0);
  return found ? found.trim().slice(0, 160) : undefined;
}

export function fingerprint(element: ElementLike): string {
  const parts = [
    tag(element),
    elementRole(element) ?? "",
    element.id ?? "",
    element.getAttribute("name") ?? "",
    element.getAttribute("data-testid") ?? "",
    structuralPath(element)
  ];
  return shortHash(parts.join("|"));
}

/** Walks up from `element` to the nearest interactive ancestor (at most `maxHops` levels). */
export function closestInteractive(element: ElementLike, maxHops = 5): ElementLike {
  let current: ElementLike | null = element;
  let hops = 0;
  while (current !== null && hops <= maxHops) {
    if (INTERACTIVE_TAGS.has(tag(current)) || current.getAttribute("role") !== null) {
      return current;
    }
    current = current.parentElement;
    hops += 1;
  }
  return element;
}

export function describeElement(element: ElementLike, lookup: DomLookup = NO_LOOKUP): SemanticElement {
  const descriptor: SemanticElement = {
    tag: tag(element).slice(0, 32),
    role: elementRole(element),
    ariaLabel: collapse(element.getAttribute("aria-label"), 160),
    name: accessibleName(element, lookup),
    text: visibleText(element),
    identifier: elementIdentifier(element),
    fingerprint: fingerprint(element)
  };
  return Object.fromEntries(Object.entries(descriptor).filter(([, value]) => value !== undefined)) as SemanticElement;
}
