import { evaluateCompletionPredicates, predicateHolds, predicateKey, stateHash, verifyStepDeterministic, type ScreenState, type VerificationState } from "@apprentice/core";
import type { CompletionPredicate, StepVerification } from "@apprentice/schemas";
import type { ScreenSnapshot } from "./snapshot.js";
import type { DomStateSource } from "./types.js";

export function screenStateOf(snapshot: ScreenSnapshot, extra: { domMarkers?: readonly string[] } = {}): VerificationState {
  const { context } = snapshot;
  const url = context.domain !== undefined ? `${context.domain}${context.path ?? "/"}` : undefined;
  const state: ScreenState = {
    url,
    domain: context.domain,
    path: context.path,
    windowTitle: context.windowTitle,
    ocrText: snapshot.ocrText,
    frontmostBundleId: context.bundleId,
    domMarkers: [...(context.domMarkers ?? []), ...(extra.domMarkers ?? [])]
  };
  return { ...state, screenshotHash: snapshot.hash, stateHash: stateHash({ ocrText: snapshot.ocrText, windowTitle: context.windowTitle, url, screenshotHash: snapshot.hash }) };
}

/**
 * URL patterns may be written with or without the domain ("/contact/:id" or
 * "crm.example/contact/:id"). Domain-less patterns get a domain-qualified twin
 * so both conventions verify against `domain + path`.
 */
export function expandPredicates(predicates: readonly CompletionPredicate[], domain: string | undefined): CompletionPredicate[] {
  const expanded: CompletionPredicate[] = [];
  for (const predicate of predicates) {
    expanded.push(predicate);
    if (predicate.kind === "url_pattern" && predicate.pattern.startsWith("/") && domain !== undefined) {
      expanded.push({ kind: "url_pattern", pattern: `${domain}${predicate.pattern}`.slice(0, 256) });
    }
  }
  return expanded;
}

/** Asks the extension for every dom_marker predicate; returns the markers reported present. */
export async function queryDomMarkers(predicates: readonly CompletionPredicate[], dom: DomStateSource, timeoutMs: number): Promise<string[]> {
  const markers = predicates.filter((predicate): predicate is Extract<CompletionPredicate, { kind: "dom_marker" }> => predicate.kind === "dom_marker");
  const present: string[] = [];
  for (const predicate of markers) {
    const result = await dom.query(predicate.marker, timeoutMs);
    if (result?.present) present.push(result.marker);
  }
  return present;
}

export interface VerifyArgs {
  readonly before: ScreenSnapshot;
  readonly after: ScreenSnapshot;
  readonly expectedResult: string;
  readonly predicates: readonly CompletionPredicate[];
  readonly dom: DomStateSource;
  readonly domTimeoutMs: number;
}

/** Deterministic verification: predicates (DOM, accessibility, app, OCR), then before/after diff. */
export async function verifyDeterministic(args: VerifyArgs): Promise<{ verification: StepVerification; beforeHash: string; afterHash: string }> {
  const predicates = expandPredicates(args.predicates, args.after.context.domain);
  const domMarkers = await queryDomMarkers(predicates, args.dom, args.domTimeoutMs);
  const before = screenStateOf(args.before);
  const after = screenStateOf(args.after, { domMarkers });
  const verification = verifyStepDeterministic({ before, after, expectedResult: args.expectedResult, predicates });
  return { verification, beforeHash: before.stateHash ?? "", afterHash: after.stateHash ?? "" };
}

/** Are the subtask's predicates satisfied on this screen (without a preceding action)? */
export async function subtaskSatisfied(snapshot: ScreenSnapshot, predicates: readonly CompletionPredicate[], dom: DomStateSource, domTimeoutMs: number): Promise<StepVerification> {
  const expanded = expandPredicates(predicates, snapshot.context.domain);
  const domMarkers = await queryDomMarkers(expanded, dom, domTimeoutMs);
  const evaluation = evaluateCompletionPredicates(expanded, screenStateOf(snapshot, { domMarkers }));
  if (evaluation.complete) {
    return { passed: true, subtaskComplete: true, method: evaluation.method, evidence: `Completion predicate satisfied: ${evaluation.satisfied.join("; ")}`.slice(0, 500), confidence: 0.9 };
  }
  return { passed: false, subtaskComplete: false, method: "none", evidence: "No completion predicate holds on the current screen", confidence: 0.2 };
}

/**
 * The only way a `user_confirm` predicate is ever satisfied: the user said so.
 * `evidence` is the sentence recorded on the step, verbatim.
 */
export function userConfirmedVerification(evidence: string): StepVerification {
  return { passed: true, subtaskComplete: true, method: "user_confirmation", evidence: evidence.slice(0, 500), confidence: 1 };
}

/**
 * Predicates that already hold before the subtask has done any work. They are
 * ignored for the rest of that subtask, so a route, title or app that was
 * already there cannot complete it on the first step.
 */
export async function holdingPredicateKeys(snapshot: ScreenSnapshot, predicates: readonly CompletionPredicate[], dom: DomStateSource, domTimeoutMs: number): Promise<string[]> {
  if (predicates.length === 0) return [];
  const domain = snapshot.context.domain;
  const domMarkers = await queryDomMarkers(expandPredicates(predicates, domain), dom, domTimeoutMs);
  const state = screenStateOf(snapshot, { domMarkers });
  return predicates.filter((predicate) => expandPredicates([predicate], domain).some((expanded) => predicateHolds(expanded, state))).map(predicateKey);
}

/** The subtask's predicates minus the ones that already held when it started. */
export function activePredicates(predicates: readonly CompletionPredicate[], ignoredKeys: readonly string[]): CompletionPredicate[] {
  return ignoredKeys.length === 0 ? [...predicates] : predicates.filter((predicate) => !ignoredKeys.includes(predicateKey(predicate)));
}

/** Records the entry-negated predicates on the step, so the trace shows why one did not fire. */
export function withIgnoredEvidence(verification: StepVerification, ignoredKeys: readonly string[]): StepVerification {
  if (ignoredKeys.length === 0) return verification;
  return { ...verification, evidence: `${verification.evidence} | ignored at subtask start: ${ignoredKeys.join("; ")}`.slice(0, 500) };
}
