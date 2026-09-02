import { describe, expect, it } from "vitest";
import { humanizeDuration, humanizeToken, humanizeTokenWithContext } from "./humanize.js";

describe("humanize", () => {
  it("turns tokens into short imperative sentences", () => {
    expect(humanizeToken("app:chrome|domain:crm.example|route:/contact/:id|action:click|role:button|name:log-activity")).toBe("Click the 'Log activity' button");
    expect(humanizeToken("app:chrome|domain:mail.example|route:/compose|action:form-submit|purpose:message")).toBe("Submit the message form");
    expect(humanizeToken("app:notion|action:shortcut|keys:cmd+shift+p")).toBe("Press Cmd+Shift+P");
    expect(humanizeToken("app:chrome|domain:crm.example|route:/deals|action:navigate")).toBe("Open /deals");
    expect(humanizeToken("app:chrome|action:download|ext:pdf")).toBe("Download a .pdf file");
    expect(humanizeToken("app:chrome|action:copy")).toBe("Copy to the clipboard");
    expect(humanizeToken("app:notion|action:activate")).toBe("Switch to Notion");
    expect(humanizeTokenWithContext("app:chrome|domain:crm.example|action:click|name:save")).toBe("Click 'Save' on crm.example");
  });

  it("formats durations", () => {
    expect(humanizeDuration(45_000)).toBe("45 s");
    expect(humanizeDuration(180_000)).toBe("3 min");
    expect(humanizeDuration(4_800_000)).toBe("1 h 20 min");
    expect(humanizeDuration(7_200_000)).toBe("2 h");
    expect(() => humanizeDuration(-1)).toThrow();
  });
});
