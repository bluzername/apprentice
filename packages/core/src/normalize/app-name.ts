const KNOWN_BUNDLE_SLUGS: Readonly<Record<string, string>> = {
  "com.google.chrome": "chrome",
  "com.google.chrome.canary": "chrome",
  "company.thebrowser.browser": "arc",
  "com.brave.browser": "brave",
  "com.microsoft.edgemac": "edge",
  "com.apple.safari": "safari",
  "org.mozilla.firefox": "firefox",
  "com.apple.mail": "mail",
  "com.apple.finder": "finder",
  "notion.id": "notion",
  "com.tinyspeck.slackmacgap": "slack",
  "com.apple.notes": "notes",
  "com.apple.ical": "calendar",
  "com.apple.preview": "preview",
  "com.microsoft.excel": "excel",
  "com.microsoft.word": "word",
  "com.microsoft.outlook": "outlook",
  "com.linear": "linear",
  "com.figma.desktop": "figma",
  "com.apple.dt.xcode": "xcode",
  "com.microsoft.vscode": "vscode",
  "com.apple.terminal": "terminal"
};

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Maps a bundle id (preferred) or display name to a stable short slug. */
export function normalizeAppName(bundleId?: string, name?: string): string {
  const bundle = (bundleId ?? "").trim().toLowerCase();
  if (bundle.length > 0) {
    const known = KNOWN_BUNDLE_SLUGS[bundle];
    if (known !== undefined) return known;
    const segments = bundle.split(".").filter((segment) => segment.length > 0);
    const last = segments[segments.length - 1];
    if (last !== undefined) {
      const slug = slugify(last);
      if (slug.length > 0) return slug;
    }
  }
  const nameSlug = slugify(name ?? "");
  return nameSlug.length > 0 ? nameSlug : "unknown";
}
