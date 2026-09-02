import { describe, expect, it } from "vitest";
import { downloadEventFor, sanitizeFilename } from "./downloads.js";

describe("sanitizeFilename", () => {
  it("keeps only extension and length, never the name", () => {
    const meta = sanitizeFilename("/Users/me/Downloads/Q3 payroll (final).XLSX");
    expect(meta).toEqual({ extension: "xlsx", length: 23 });
    expect(JSON.stringify(meta)).not.toContain("payroll");
  });

  it("handles missing extensions, dotfiles, and odd characters", () => {
    expect(sanitizeFilename("README")).toEqual({ extension: "", length: 6 });
    expect(sanitizeFilename(".bashrc")).toEqual({ extension: "", length: 7 });
    expect(sanitizeFilename("archive.tar.gz?x")).toEqual({ extension: "gzx", length: 16 });
    expect(sanitizeFilename("a." + "b".repeat(40)).extension).toHaveLength(16);
  });
});

describe("downloadEventFor", () => {
  it("emits a download event for allowlisted referrers", () => {
    const event = downloadEventFor(
      { filename: "/tmp/report.pdf", url: "https://cdn.other.com/f?sig=1", referrer: "https://app.example.com/reports?id=3" },
      ["example.com"],
      1234
    );
    expect(event).toMatchObject({ type: "download", domain: "example.com", path: "/reports", ts: 1234, filenameMeta: { extension: "pdf", length: 10 } });
    expect(JSON.stringify(event)).not.toContain("sig=1");
  });

  it("falls back to the download url and its path when there is no referrer or filename", () => {
    const event = downloadEventFor({ url: "https://files.example.com/export/data.csv" }, ["example.com"]);
    expect(event?.filenameMeta).toEqual({ extension: "csv", length: 8 });
  });

  it("returns null for domains outside the allowlist", () => {
    expect(downloadEventFor({ url: "https://bank.example.net/statement.pdf", referrer: "https://bank.example.net/" }, ["example.com"])).toBeNull();
    expect(downloadEventFor({ url: "blob:https://example.com/abc" }, ["example.com"])).toBeNull();
  });
});
