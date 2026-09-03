import { describe, expect, it } from "vitest";
import { humanizeAppName, humanizeContext, humanizeDuration, humanizeToken, humanizeTokenWithContext } from "./humanize.js";

describe("humanize", () => {
  it("turns tokens into short imperative sentences", () => {
    expect(humanizeToken("app:chrome|domain:crm.example|route:/contact/:id|action:click|role:button|name:log-activity")).toBe("Click the 'Log activity' button");
    expect(humanizeToken("app:chrome|domain:mail.example|route:/compose|action:form-submit|purpose:message")).toBe("Submit the message form");
    expect(humanizeToken("app:notion|action:shortcut|keys:cmd+shift+p")).toBe("Press Cmd+Shift+P");
    expect(humanizeToken("app:chrome|domain:crm.example|route:/deals|action:navigate")).toBe("Open /deals");
    expect(humanizeToken("app:chrome|action:download|ext:pdf")).toBe("Download a .pdf file");
    expect(humanizeToken("app:chrome|action:copy")).toBe("Copy to the clipboard");
    expect(humanizeToken("app:notion|action:activate")).toBe("Switch to Notion");
    expect(humanizeToken("app:chrome|site:gmail|view:inbox|action:view")).toBe("Open Gmail inbox");
    expect(humanizeToken("app:chrome|site:google-sheets|view:document|action:view")).toBe("Open a Google Sheets document");
    expect(humanizeToken("app:chrome|site:gmail|view:page|action:view")).toBe("Open a Gmail message");
    expect(humanizeToken("app:chrome|site:github|view:page|action:view")).toBe("Open a GitHub page");
    expect(humanizeToken("app:chrome|site:web|view:login|action:view")).toBe("Sign in to web");
    expect(humanizeToken("app:chrome|site:acme-store|view:checkout|action:view")).toBe("Open Acme store checkout");
    expect(humanizeTokenWithContext("app:chrome|domain:crm.example|action:click|name:save")).toBe("Click 'Save' on crm.example");
  });

  it("names apps and file entries for people", () => {
    expect(humanizeAppName("textedit")).toBe("TextEdit");
    expect(humanizeAppName("finder")).toBe("Finder");
    expect(humanizeAppName("preview")).toBe("Preview");
    expect(humanizeAppName("chrome")).toBe("Google Chrome");
    expect(humanizeAppName("some-new-tool")).toBe("Some New Tool");
    expect(humanizeContext("app:chrome|domain:crm.example|action:copy")).toBe("crm.example");
    expect(humanizeContext("app:textedit|action:copy")).toBe("TextEdit");
    expect(humanizeContext("action:copy")).toBeUndefined();
    expect(humanizeToken("app:finder|action:click|role:textbox|name:download-1-pdf")).toBe("Open 'download-1.pdf'");
    expect(humanizeToken("app:textedit|action:click|name:ledger-txt")).toBe("Open 'ledger.txt'");
    expect(humanizeToken("app:finder|action:click|role:row|name:q3-report-xlsx")).toBe("Open 'q3-report.xlsx'");
    expect(humanizeToken("app:chrome|action:click|role:button|name:export-pdf")).toBe("Click the 'Export pdf' button");
    expect(humanizeToken("app:notion|action:click|name:meeting-notes")).toBe("Click 'Meeting notes'");
    expect(humanizeTokenWithContext("app:finder|action:click|role:textbox|name:download-1-pdf")).toBe("Open 'download-1.pdf' on finder");
  });

  it("formats durations", () => {
    expect(humanizeDuration(45_000)).toBe("45 s");
    expect(humanizeDuration(180_000)).toBe("3 min");
    expect(humanizeDuration(4_800_000)).toBe("1 h 20 min");
    expect(humanizeDuration(7_200_000)).toBe("2 h");
    expect(() => humanizeDuration(-1)).toThrow();
  });
});
