/**
 * DOM capture session for one allowlisted page. Attaches listeners only when
 * told to, detaches on request, and pauses itself in sensitive contexts.
 * It never reads input values or clipboard contents.
 */
import type { ExtensionEvent } from "@apprentice/schemas";
import { MAX_LABEL_LENGTH, MAX_TITLE_LENGTH } from "../shared/constants.js";
import { newEventId } from "../shared/id.js";
import type { DomQueryReply } from "../shared/messages.js";
import { stripUrl } from "../shared/url.js";
import { closestInteractive, describeElement, type DomLookup, type ElementLike } from "./descriptor.js";
import { classifyFormPurpose } from "./form-purpose.js";
import { SENSITIVE_META_NAME, sensitiveFieldReason, sensitivePageReason, type SensitiveReason } from "./sensitive.js";

export interface CaptureSession {
  attach(): void;
  detach(): void;
  attached(): boolean;
  answerDomQuery(marker: string): DomQueryReply;
}

interface SessionState {
  readonly attached: boolean;
  readonly sensitivePath: string | null;
  readonly lastPath: string;
  readonly lastTitle: string;
  readonly lastFieldKey: string;
}

const NAVIGATION_POLL_MS = 1000;
const TITLE_DEBOUNCE_MS = 300;
const FIELD_TAGS: ReadonlySet<string> = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function truncateTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_LENGTH);
}

function isElement(target: EventTarget | null): target is HTMLElement {
  return target instanceof HTMLElement;
}

function fieldLabelFor(element: HTMLElement): string | undefined {
  const control = element as HTMLInputElement;
  const fromLabel = control.labels && control.labels.length > 0 ? control.labels[0]?.textContent : null;
  const candidates = [fromLabel, element.getAttribute("aria-label"), element.getAttribute("placeholder")];
  const found = candidates.find((value) => typeof value === "string" && value.trim().length > 0);
  return found ? found.replace(/\s+/g, " ").trim().slice(0, MAX_LABEL_LENGTH) : undefined;
}

/** Length of the current value for text-like controls; 0 for checkboxes, radios, and files. */
function valueLengthFor(element: HTMLElement): number {
  if (element instanceof HTMLInputElement) {
    const type = element.type.toLowerCase();
    if (type === "checkbox" || type === "radio" || type === "file" || type === "password") {
      return 0;
    }
    return Math.min(element.value.length, 100000);
  }
  if (element instanceof HTMLTextAreaElement) {
    return Math.min(element.value.length, 100000);
  }
  if (element instanceof HTMLSelectElement) {
    return element.selectedOptions.length;
  }
  return 0;
}

function formSignals(form: HTMLFormElement, submitter: HTMLElement | null): Parameters<typeof classifyFormPurpose>[0] {
  const action = stripUrl(form.action);
  const fields = Array.from(form.elements).filter((el): el is HTMLElement => el instanceof HTMLElement);
  const buttonText =
    submitter?.textContent ??
    submitter?.getAttribute("value") ??
    form.querySelector("button[type=submit], input[type=submit], button:not([type])")?.textContent ??
    "";
  return {
    actionPath: action?.path ?? "",
    method: form.method,
    buttonText: buttonText.trim().slice(0, 80),
    fieldNames: fields.map((el) => el.getAttribute("name") ?? "").filter((name) => name.length > 0),
    fieldTypes: fields.map((el) => (el instanceof HTMLInputElement ? el.type : el.tagName.toLowerCase()))
  };
}

export function createCaptureSession(
  doc: Document,
  win: Window,
  emit: (event: ExtensionEvent) => void
): CaptureSession {
  let state: SessionState = { attached: false, sensitivePath: null, lastPath: "", lastTitle: "", lastFieldKey: "" };
  let controller: AbortController | null = null;
  let observer: MutationObserver | null = null;
  let navigationTimer: number | null = null;
  let titleTimer: number | null = null;

  const lookup: DomLookup = { byId: (id) => doc.getElementById(id) };

  const location = (): { domain: string; path: string } | null => {
    const stripped = stripUrl(win.location.href);
    return stripped === null ? null : { domain: stripped.domain, path: stripped.path };
  };

  const base = (type: ExtensionEvent["type"]): ExtensionEvent | null => {
    const here = location();
    return here === null ? null : { id: newEventId(), ts: Date.now(), type, domain: here.domain, path: here.path };
  };

  const send = (event: ExtensionEvent | null): void => {
    if (event !== null && state.attached) {
      emit(event);
    }
  };

  const paused = (): boolean => state.sensitivePath !== null;

  const pause = (reason: SensitiveReason): void => {
    if (paused()) {
      return;
    }
    const here = location();
    state = { ...state, sensitivePath: here?.path ?? "" };
    const event = base("sensitive_pause");
    send(event === null ? null : { ...event, sensitiveReason: reason });
  };

  const pageSignals = (): Parameters<typeof sensitivePageReason>[0] => ({
    title: doc.title ?? "",
    path: location()?.path ?? "",
    hasSensitiveMeta: doc.querySelector(`meta[name="${SENSITIVE_META_NAME}"]`) !== null
  });

  const evaluatePage = (): void => {
    const reason = sensitivePageReason(pageSignals());
    if (reason !== null) {
      pause(reason);
    }
  };

  const emitTitle = (): void => {
    const title = truncateTitle(doc.title ?? "");
    if (title.length === 0 || title === state.lastTitle) {
      return;
    }
    state = { ...state, lastTitle: title };
    evaluatePage();
    if (paused()) {
      return;
    }
    const event = base("page_title");
    send(event === null ? null : { ...event, title });
  };

  const checkNavigation = (): void => {
    const here = location();
    if (here === null || here.path === state.lastPath) {
      return;
    }
    if (paused() && state.sensitivePath !== here.path) {
      state = { ...state, sensitivePath: null, lastTitle: "" };
      send(base("sensitive_resume"));
    }
    state = { ...state, lastPath: here.path, lastFieldKey: "" };
    evaluatePage();
    if (paused()) {
      return;
    }
    send(base("navigation"));
    emitTitle();
  };

  const onClick = (event: MouseEvent): void => {
    if (paused() || !isElement(event.target)) {
      return;
    }
    const target = closestInteractive(event.target as ElementLike) as unknown as HTMLElement;
    const clickEvent = base("click");
    send(clickEvent === null ? null : { ...clickEvent, element: describeElement(target, lookup) });
    win.setTimeout(checkNavigation, 50);
  };

  const onFocusIn = (event: FocusEvent): void => {
    if (!isElement(event.target)) {
      return;
    }
    const reason = sensitiveFieldReason({
      tagName: event.target.tagName,
      type: event.target.getAttribute("type"),
      autocomplete: event.target.getAttribute("autocomplete")
    });
    if (reason !== null) {
      pause(reason);
    }
  };

  const onSubmit = (event: SubmitEvent): void => {
    if (paused() || !(event.target instanceof HTMLFormElement)) {
      return;
    }
    const submitter = isElement(event.submitter) ? event.submitter : null;
    const submitEvent = base("form_submit");
    send(submitEvent === null ? null : { ...submitEvent, formPurpose: classifyFormPurpose(formSignals(event.target, submitter)) });
    win.setTimeout(checkNavigation, 50);
  };

  const onFieldEvent = (event: Event): void => {
    if (paused() || !isElement(event.target) || !FIELD_TAGS.has(event.target.tagName)) {
      return;
    }
    const element = event.target;
    if (
      sensitiveFieldReason({
        tagName: element.tagName,
        type: element.getAttribute("type"),
        autocomplete: element.getAttribute("autocomplete")
      }) !== null
    ) {
      return;
    }
    const descriptor = describeElement(element, lookup);
    const valueLength = valueLengthFor(element);
    const key = `${descriptor.fingerprint ?? ""}:${valueLength}`;
    if (key === state.lastFieldKey) {
      return;
    }
    state = { ...state, lastFieldKey: key };
    const fieldEvent = base("field_input");
    send(
      fieldEvent === null
        ? null
        : { ...fieldEvent, element: descriptor, fieldLabel: fieldLabelFor(element), valueLength }
    );
  };

  const onClipboard = (type: "copy" | "paste") => (): void => {
    if (paused()) {
      return;
    }
    send(base(type));
  };

  const scheduleTitle = (): void => {
    if (titleTimer !== null) {
      win.clearTimeout(titleTimer);
    }
    titleTimer = win.setTimeout(() => {
      titleTimer = null;
      emitTitle();
    }, TITLE_DEBOUNCE_MS);
  };

  const attach = (): void => {
    if (state.attached) {
      return;
    }
    controller = new AbortController();
    const signal = controller.signal;
    state = { ...state, attached: true, lastPath: "", lastTitle: "", lastFieldKey: "" };
    doc.addEventListener("click", onClick, { capture: true, signal });
    doc.addEventListener("focusin", onFocusIn, { capture: true, signal });
    doc.addEventListener("submit", onSubmit, { capture: true, signal });
    doc.addEventListener("change", onFieldEvent, { capture: true, signal });
    doc.addEventListener("focusout", onFieldEvent, { capture: true, signal });
    doc.addEventListener("copy", onClipboard("copy"), { capture: true, signal });
    doc.addEventListener("paste", onClipboard("paste"), { capture: true, signal });
    win.addEventListener("popstate", checkNavigation, { signal });
    observer = new MutationObserver(scheduleTitle);
    if (doc.head) {
      observer.observe(doc.head, { childList: true, subtree: true, characterData: true });
    }
    navigationTimer = win.setInterval(checkNavigation, NAVIGATION_POLL_MS);
    checkNavigation();
  };

  const detach = (): void => {
    if (!state.attached) {
      return;
    }
    controller?.abort();
    controller = null;
    observer?.disconnect();
    observer = null;
    if (navigationTimer !== null) {
      win.clearInterval(navigationTimer);
      navigationTimer = null;
    }
    if (titleTimer !== null) {
      win.clearTimeout(titleTimer);
      titleTimer = null;
    }
    state = { ...state, attached: false, sensitivePath: null };
  };

  const answerDomQuery = (marker: string): DomQueryReply => {
    const here = location();
    const trimmed = marker.trim();
    let present = false;
    if (/^[#.[]/.test(trimmed)) {
      try {
        present = doc.querySelector(trimmed) !== null;
      } catch {
        present = false;
      }
    }
    if (!present && trimmed.length > 0) {
      present = (doc.body?.innerText ?? "").includes(trimmed) || doc.title.includes(trimmed);
    }
    return { present, domain: here?.domain, path: here?.path };
  };

  return { attach, detach, attached: () => state.attached, answerDomQuery };
}
