import type { CompletionPredicate, StepVerification } from "@apprentice/schemas";
import { evaluateCompletionPredicates, stateHash, type ScreenState, type StateHashInput } from "./predicates.js";

export type VerificationState = ScreenState & StateHashInput & { readonly stateHash?: string };

export interface VerifyStepInput {
  readonly before: VerificationState;
  readonly after: VerificationState;
  readonly expectedResult: string;
  readonly predicates: readonly CompletionPredicate[];
}

export interface OcrDiff {
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

const MAX_DIFF_LINES = 50;

function lines(text: string | undefined): string[] {
  return (text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line.length > 0);
}

export function ocrDiff(before: string | undefined, after: string | undefined): OcrDiff {
  const beforeSet = new Set(lines(before));
  const afterSet = new Set(lines(after));
  return {
    added: [...afterSet].filter((line) => !beforeSet.has(line)).slice(0, MAX_DIFF_LINES),
    removed: [...beforeSet].filter((line) => !afterSet.has(line)).slice(0, MAX_DIFF_LINES)
  };
}

function expectedWordsFound(expected: string, added: readonly string[]): number {
  const words = expected.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4);
  if (words.length === 0) return 0;
  const joined = added.join(" ");
  return words.filter((word) => joined.includes(word)).length / words.length;
}

/**
 * Deterministic step verification. Passes only on predicates, user
 * confirmation, or an observed screen change; never on model claims.
 */
export function verifyStepDeterministic(input: VerifyStepInput): StepVerification {
  const evaluation = evaluateCompletionPredicates(input.predicates, input.after);
  if (evaluation.complete) {
    return {
      passed: true,
      subtaskComplete: true,
      method: evaluation.method,
      evidence: `Completion predicate satisfied: ${evaluation.satisfied.join("; ")}`.slice(0, 500),
      confidence: 0.9
    };
  }
  const beforeHash = input.before.stateHash ?? stateHash(input.before);
  const afterHash = input.after.stateHash ?? stateHash(input.after);
  const diff = ocrDiff(input.before.ocrText, input.after.ocrText);
  const changed = beforeHash !== afterHash;
  if (changed && (diff.added.length > 0 || diff.removed.length > 0)) {
    const support = expectedWordsFound(input.expectedResult, diff.added);
    return {
      passed: true,
      subtaskComplete: false,
      method: "screen_diff_ocr",
      evidence: `Screen changed. Added: ${diff.added.slice(0, 5).join(" | ")}. Removed: ${diff.removed.slice(0, 5).join(" | ")}`.slice(0, 500),
      confidence: Math.round((0.5 + 0.4 * support) * 100) / 100
    };
  }
  if (changed) {
    return { passed: true, subtaskComplete: false, method: "screen_diff_ocr", evidence: "State hash changed without an OCR text difference", confidence: 0.4 };
  }
  return { passed: false, subtaskComplete: false, method: "screen_diff_ocr", evidence: "No visible change after the action", confidence: 0.2 };
}
