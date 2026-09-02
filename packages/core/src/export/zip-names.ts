export const MAX_ZIP_ENTRY_NAME_LENGTH = 200;
const DRIVE_LETTER_RE = /^[a-zA-Z]:/;
const PRINTABLE_ASCII_RE = /^[ -~]+$/;

/** Rejects absolute paths, traversal, backslashes, drive letters, non-ascii, and overlong names. */
export function assertSafeZipEntryName(name: string): void {
  if (name.length === 0) throw new Error("Zip entry name is empty");
  if (name.length > MAX_ZIP_ENTRY_NAME_LENGTH) throw new Error(`Zip entry name exceeds ${MAX_ZIP_ENTRY_NAME_LENGTH} chars`);
  if (!PRINTABLE_ASCII_RE.test(name)) throw new Error(`Zip entry name must be printable ascii: ${JSON.stringify(name)}`);
  if (name.includes("\\")) throw new Error(`Zip entry name contains a backslash: ${name}`);
  if (name.startsWith("/")) throw new Error(`Zip entry name is absolute: ${name}`);
  if (DRIVE_LETTER_RE.test(name)) throw new Error(`Zip entry name has a drive letter: ${name}`);
  const segments = name.split("/");
  if (segments.some((segment) => segment === "..")) throw new Error(`Zip entry name traverses upward: ${name}`);
  if (segments.some((segment) => segment === "." || segment.length === 0)) throw new Error(`Zip entry name has an empty or dot segment: ${name}`);
}

export function isSafeZipEntryName(name: string): boolean {
  try {
    assertSafeZipEntryName(name);
    return true;
  } catch {
    return false;
  }
}
