/** Heuristic form purpose classification from structure only. Field values are never consulted. */
import type { ExtensionEvent } from "@apprentice/schemas";

export type FormPurpose = NonNullable<ExtensionEvent["formPurpose"]>;

export interface FormSignals {
  readonly actionPath: string;
  readonly method: string;
  readonly buttonText: string;
  readonly fieldNames: readonly string[];
  readonly fieldTypes: readonly string[];
}

const LOGIN_NAMES = /pass(word|wd)?|otp|one[-_]?time|totp|2fa|mfa|login|signin|sign_in|username/;
const CHECKOUT_PATH = /checkout|cart|payment|billing|order|pay\b/;
const CHECKOUT_BUTTON = /\b(pay|place order|checkout|buy|purchase|complete order)\b/;
const CHECKOUT_NAMES = /^(cc|card|cvv|cvc|expiry|exp_|shipping|billing)/;
const SEARCH_NAMES = /^(q|s|query|search|keywords?|term|k)$/;
const SEARCH_BUTTON = /\b(search|find|go)\b/;
const MESSAGE_NAMES = /^(message|msg|body|comment|reply|text|content|note|description)$/;
const MESSAGE_BUTTON = /\b(send|post|reply|comment|submit reply|tweet|publish)\b/;
const CREATE_PATH = /\/(new|create|add|register|signup|sign-up)(\/|$)/;
const CREATE_BUTTON = /\b(create|add|new|register|sign up|save as new)\b/;
const UPDATE_PATH = /\/(edit|update|settings|profile|preferences|account)(\/|$)/;
const UPDATE_BUTTON = /\b(save|update|apply|change|edit|rename)\b/;

function lower(values: readonly string[]): readonly string[] {
  return values.map((value) => value.trim().toLowerCase());
}

export function classifyFormPurpose(signals: FormSignals): FormPurpose {
  const path = signals.actionPath.toLowerCase();
  const button = signals.buttonText.trim().toLowerCase();
  const names = lower(signals.fieldNames);
  const types = lower(signals.fieldTypes);
  const method = signals.method.trim().toLowerCase();

  if (types.includes("password") || names.some((name) => LOGIN_NAMES.test(name))) {
    return "login";
  }
  if (CHECKOUT_PATH.test(path) || CHECKOUT_BUTTON.test(button) || names.some((name) => CHECKOUT_NAMES.test(name))) {
    return "checkout";
  }
  if (types.includes("file")) {
    return "upload";
  }
  if (
    types.includes("search") ||
    /\/search(\/|$)/.test(path) ||
    (names.some((name) => SEARCH_NAMES.test(name)) && (method === "get" || method === "")) ||
    (SEARCH_BUTTON.test(button) && names.some((name) => SEARCH_NAMES.test(name)))
  ) {
    return "search";
  }
  if (MESSAGE_BUTTON.test(button) || (types.includes("textarea") && names.some((name) => MESSAGE_NAMES.test(name)))) {
    return "message";
  }
  if (CREATE_PATH.test(path) || CREATE_BUTTON.test(button)) {
    return "create";
  }
  if (UPDATE_PATH.test(path) || UPDATE_BUTTON.test(button) || method === "put" || method === "patch") {
    return "update";
  }
  return "unknown";
}
