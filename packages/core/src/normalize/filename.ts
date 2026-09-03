/** Document and media extensions that mark a normalized label as a filename ("download-1-pdf"). */
export const FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  "pdf", "txt", "rtf", "md", "doc", "docx", "xls", "xlsx", "csv", "ppt", "pptx", "key", "numbers", "pages",
  "json", "xml", "yaml", "yml", "html", "htm", "png", "jpg", "jpeg", "gif", "heic", "svg", "webp",
  "mov", "mp4", "mp3", "wav", "m4a", "zip", "dmg", "pkg", "log"
]);

/** Element roles whose label is a file entry rather than a control: list rows, cells, name fields, icons. */
export const FILENAME_ROLES: ReadonlySet<string> = new Set(["row", "cell", "textbox", "text", "image"]);

const EXTENSION_RE = /^(.+)-([a-z0-9]{2,7})$/;

/** "download-1-pdf" -> "download-1.pdf"; undefined when the label does not end in a known extension. */
export function filenameFromLabel(label: string): string | undefined {
  const match = EXTENSION_RE.exec(label);
  if (match === null) return undefined;
  const [, stem, extension] = match;
  if (stem === undefined || extension === undefined || !FILE_EXTENSIONS.has(extension)) return undefined;
  return `${stem}.${extension}`;
}

/** The filename a click token opened, when its label looks like one and its role is a file entry. */
export function clickedFilename(parts: Readonly<Record<string, string>>): string | undefined {
  if (parts["action"] !== "click" || parts["name"] === undefined) return undefined;
  if (parts["role"] !== undefined && !FILENAME_ROLES.has(parts["role"])) return undefined;
  return filenameFromLabel(parts["name"]);
}
