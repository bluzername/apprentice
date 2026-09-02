/** Symbols used to make invisible characters visible in typed-text previews. */
export const RETURN_SYMBOL = "\u23CE";
export const SPACE_SYMBOL = "\u2423";

const LINE_BREAK = /\r\n|\n/g;

/** Number of line breaks (LF or CRLF) the helper would press Enter for. */
export function countLineBreaks(text: string): number {
  return text.match(LINE_BREAK)?.length ?? 0;
}

function markEdgeSpaces(line: string): string {
  const leading = line.match(/^ */)?.[0].length ?? 0;
  const trailing = line.match(/ *$/)?.[0].length ?? 0;
  if (leading === line.length) return SPACE_SYMBOL.repeat(line.length);
  return `${SPACE_SYMBOL.repeat(leading)}${line.slice(leading, line.length - trailing)}${SPACE_SYMBOL.repeat(trailing)}`;
}

/**
 * Shows the exact text that will be typed with every invisible character made
 * visible: line breaks become a return symbol followed by a newline, leading
 * and trailing spaces on each line become an open-box symbol.
 */
export function visualizeTypedText(text: string): string {
  return text
    .split(LINE_BREAK)
    .map(markEdgeSpaces)
    .join(`${RETURN_SYMBOL}\n`);
}

/** Hint sentence for texts containing line breaks, null otherwise. */
export function lineBreakHint(text: string): string | null {
  const count = countLineBreaks(text);
  if (count === 0) return null;
  return `Contains ${count} line ${count === 1 ? "break" : "breaks"}: each one presses Enter.`;
}
