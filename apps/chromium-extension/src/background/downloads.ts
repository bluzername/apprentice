/** Download observation: emits filename metadata only, never the file name itself. */
import type { ExtensionEvent } from "@apprentice/schemas";
import { newEventId } from "../shared/id.js";
import { isDomainAllowlisted, stripUrl } from "../shared/url.js";

export interface FilenameMeta {
  readonly extension: string;
  readonly length: number;
}

/** Extracts a lowercase, alphanumeric extension (max 16 chars) and the base name length. */
export function sanitizeFilename(filename: string): FilenameMeta {
  const base = filename.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  const rawExtension = dot > 0 ? base.slice(dot + 1) : "";
  const extension = rawExtension.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16);
  return { extension, length: base.length };
}

export interface DownloadLike {
  readonly filename?: string;
  readonly url?: string;
  readonly referrer?: string;
}

/** Builds a download event when the referrer (or, failing that, the URL) belongs to an allowlisted domain. */
export function downloadEventFor(
  item: DownloadLike,
  allowlist: readonly string[],
  now: number = Date.now()
): ExtensionEvent | null {
  const source = stripUrl(item.referrer ?? "") ?? stripUrl(item.url ?? "");
  if (source === null || !isDomainAllowlisted(source.domain, allowlist)) {
    return null;
  }
  const name = item.filename && item.filename.length > 0 ? item.filename : (stripUrl(item.url ?? "")?.path ?? "");
  return {
    id: newEventId(),
    ts: now,
    type: "download",
    domain: source.domain,
    path: source.path,
    filenameMeta: sanitizeFilename(name)
  };
}
