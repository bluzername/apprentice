import { evaluateCompletionPredicates, stateHash, verifyStepDeterministic, type ScreenState, type VerificationState } from "@apprentice/core";
import type { CompletionPredicate, StepVerification } from "@apprentice/schemas";
import type { ScreenSnapshot } from "./snapshot.js";
import type { DomStateSource } from "./types.js";

export function screenStateOf(snapshot: ScreenSnapshot, extra: { domMarkers?: readonly string[]; userConfirmed?: boolean } = {}): VerificationState {
  const { context } = snapshot;
  const url = context.domain !== undefined ? `${context.domain}${context.path ?? "/"}` : undefined;
  const state: ScreenState = {
    url,
    domain: context.domain,
    path: context.path,
    windowTitle: context.windowTitle,
    ocrText: snapshot.ocrText,
    frontmostBundleId: context.bundleId,
    domMarkers: [...(context.domMarkers ?? []), ...(extra.domMarkers ?? [])],
    userConfirmed: extra.userConfirmed
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

export function userConfirmedVerification(question: string): StepVerification {
  return { passed: true, subtaskComplete: true, method: "user_confirmation", evidence: `User confirmed: ${question}`.slice(0, 500), confidence: 1 };
}
