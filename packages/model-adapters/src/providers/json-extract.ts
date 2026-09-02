/**
 * Pull the first JSON object out of a chat reply that may wrap it in prose or
 * code fences. Strings and escapes are respected while balancing braces.
 */

export type JsonExtraction = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly reason: string };

const THINK_BLOCK = /<think\b[^>]*>[\s\S]*?<\/think>/gi;

/** Remove any hidden-reasoning blocks so they are never parsed or retained. */
export function stripThinkBlocks(text: string): string {
  return text.replace(THINK_BLOCK, "");
}

function findObjectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

export function extractFirstJsonObject(text: string): JsonExtraction {
  const cleaned = stripThinkBlocks(text);
  let start = cleaned.indexOf("{");
  while (start !== -1) {
    const end = findObjectEnd(cleaned, start);
    if (end === -1) {
      return { ok: false, reason: "unbalanced JSON object in model reply" };
    }
    try {
      return { ok: true, value: JSON.parse(cleaned.slice(start, end + 1)) as unknown };
    } catch {
      start = cleaned.indexOf("{", start + 1);
    }
  }
  return { ok: false, reason: "no JSON object found in model reply" };
}
