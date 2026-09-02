import { describe, expect, it } from "vitest";
import { captureAllowed, contentScriptForDomain, diffRegistrations, domainFromScriptId, scriptIdForDomain } from "./registration.js";

describe("registration helpers", () => {
  it("diffs desired domains against registered ids and ignores foreign ids", () => {
    const diff = diffRegistrations(["example.com", "docs.example.org"], [scriptIdForDomain("example.com"), scriptIdForDomain("old.net"), "other-ext"]);
    expect(diff.toRegister).toEqual([scriptIdForDomain("docs.example.org")]);
    expect(diff.toUnregister).toEqual([scriptIdForDomain("old.net")]);
  });

  it("round-trips script ids and builds registrations with explicit match patterns", () => {
    expect(domainFromScriptId(scriptIdForDomain("Example.com"))).toBe("example.com");
    expect(domainFromScriptId("something-else")).toBeNull();
    const script = contentScriptForDomain("example.com");
    expect(script).toMatchObject({ js: ["content.js"], matches: ["https://*.example.com/*", "http://*.example.com/*"], runAt: "document_idle", allFrames: false });
  });

  it("only allows capture while paired, enabled, learning, and not locally paused", () => {
    const base = { paired: true, captureEnabled: true, learningState: "learning", localPaused: false };
    expect(captureAllowed(base)).toBe(true);
    expect(captureAllowed({ ...base, paired: false })).toBe(false);
    expect(captureAllowed({ ...base, captureEnabled: false })).toBe(false);
    expect(captureAllowed({ ...base, learningState: "paused" })).toBe(false);
    expect(captureAllowed({ ...base, learningState: "private" })).toBe(false);
    expect(captureAllowed({ ...base, learningState: "stopped" })).toBe(false);
    expect(captureAllowed({ ...base, localPaused: true })).toBe(false);
  });
});
