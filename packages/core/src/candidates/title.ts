import { humanizeAppName, humanizeContext, humanizeKeys, humanizeToken, humanizeView } from "../humanize.js";
import { OUTCOME_CLICK_TERMS, OUTCOME_SHORTCUTS } from "../episodes/boundaries.js";
import { clickedFilename } from "../normalize/filename.js";
import { parseToken } from "../normalize/token.js";

const MAX_TITLE = 160;

/** "cmd+s" -> "Save", "cmd+enter" -> "Submit". */
const SHORTCUT_OUTCOMES: Readonly<Record<string, string>> = { "cmd+s": "Save", "cmd+enter": "Submit", "cmd+return": "Submit" };

function words(label: string): string {
  return label.replace(/-+/g, " ").trim();
}

function capitalize(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}

function lowerFirst(text: string): string {
  return text.length === 0 ? text : text[0]!.toLowerCase() + text.slice(1);
}

/** Leading verb of a humanized sentence turned into its -ing form: "Open Gmail inbox" -> "opening Gmail inbox". */
function gerundOfSentence(sentence: string): string {
  const [verb, ...rest] = sentence.split(" ");
  if (verb === undefined) return sentence;
  const base = verb.toLowerCase();
  const gerund = base.endsWith("e") && !base.endsWith("ee") ? `${base.slice(0, -1)}ing` : `${base}ing`;
  return [gerund, ...rest].join(" ");
}

/** What the workflow achieves, as a short verb phrase: "Save", "Submit the update form", "Click 'Log activity'". */
export function outcomePhrase(token: string): string {
  const parts = parseToken(token);
  const keys = parts["keys"];
  if (parts["action"] === "shortcut" && keys !== undefined && OUTCOME_SHORTCUTS.has(keys)) {
    return SHORTCUT_OUTCOMES[keys] ?? `Press ${humanizeKeys(keys)}`;
  }
  const name = parts["name"];
  if (parts["action"] === "click" && name !== undefined && clickedFilename(parts) === undefined) {
    const nameWords = name.split("-");
    if (OUTCOME_CLICK_TERMS.some((term) => nameWords.includes(term))) return capitalize(words(name));
  }
  return humanizeToken(token);
}

/** What started the workflow, as a lowercase -ing phrase: "opening 'download-1.pdf'", "clicking 'Meeting notes'". */
export function triggerPhrase(token: string): string {
  const parts = parseToken(token);
  const filename = clickedFilename(parts);
  const name = parts["name"] !== undefined ? capitalize(words(parts["name"])) : undefined;
  const role = parts["role"] !== undefined ? words(parts["role"]) : undefined;
  switch (parts["action"]) {
    case "click":
      if (filename !== undefined) return `opening '${filename}'`;
      if (name !== undefined && role !== undefined) return `clicking the '${name}' ${role}`;
      if (name !== undefined) return `clicking '${name}'`;
      return role !== undefined ? `clicking a ${role}` : "clicking";
    case "form-submit": {
      const purpose = parts["purpose"];
      return purpose !== undefined && purpose !== "unknown" ? `submitting the ${words(purpose)} form` : "submitting the form";
    }
    case "navigate":
      return parts["route"] !== undefined ? `opening ${parts["route"]}` : "navigating";
    case "shortcut":
      if (parts["keys"] === "cmd+s") return "saving";
      return parts["keys"] !== undefined ? `pressing ${humanizeKeys(parts["keys"])}` : "pressing a shortcut";
    case "download":
      return parts["ext"] !== undefined ? `downloading a .${parts["ext"]} file` : "downloading a file";
    case "copy":
      return "copying to the clipboard";
    case "paste":
      return "pasting from the clipboard";
    case "field-input":
      return parts["field"] !== undefined ? `filling in '${capitalize(words(parts["field"]))}'` : "filling in a field";
    case "activate":
      return parts["app"] !== undefined ? `switching to ${humanizeAppName(parts["app"])}` : "switching app";
    case "view":
      return gerundOfSentence(humanizeView(parts["site"], parts["view"]));
    default:
      return lowerFirst(humanizeToken(token));
  }
}

/**
 * Deterministic, readable title: "<Outcome> in <app> after <trigger> in <app>",
 * e.g. "Save in TextEdit after opening 'download-1.pdf' in Finder". The app is
 * named once when both ends share it, and once only when there is a single token.
 */
export function deterministicTitle(triggerToken: string | undefined, outcomeToken: string | undefined): string {
  if (outcomeToken === undefined && triggerToken === undefined) return "Repeated workflow";
  const outcome = outcomeToken ?? triggerToken!;
  const outcomeContext = humanizeContext(outcome);
  const outcomeText = outcomeContext !== undefined ? `${outcomePhrase(outcome)} in ${outcomeContext}` : outcomePhrase(outcome);
  if (triggerToken === undefined || triggerToken === outcome) return outcomeText.slice(0, MAX_TITLE);
  const triggerContext = humanizeContext(triggerToken);
  if (triggerContext !== undefined && triggerContext === outcomeContext) {
    return `${outcomePhrase(outcome)} after ${triggerPhrase(triggerToken)} in ${outcomeContext}`.slice(0, MAX_TITLE);
  }
  const triggerText = triggerContext !== undefined ? `${triggerPhrase(triggerToken)} in ${triggerContext}` : triggerPhrase(triggerToken);
  return `${outcomeText} after ${triggerText}`.slice(0, MAX_TITLE);
}
