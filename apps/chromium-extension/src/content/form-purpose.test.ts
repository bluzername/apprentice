import { describe, expect, it } from "vitest";
import { classifyFormPurpose, type FormSignals } from "./form-purpose.js";

function signals(partial: Partial<FormSignals>): FormSignals {
  return { actionPath: "", method: "post", buttonText: "", fieldNames: [], fieldTypes: [], ...partial };
}

describe("classifyFormPurpose", () => {
  it("detects login from password fields or credential names", () => {
    expect(classifyFormPurpose(signals({ fieldTypes: ["text", "password"] }))).toBe("login");
    expect(classifyFormPurpose(signals({ fieldNames: ["username", "otp_code"] }))).toBe("login");
  });

  it("detects search from GET forms with q, search paths, or search inputs", () => {
    expect(classifyFormPurpose(signals({ method: "get", fieldNames: ["q"] }))).toBe("search");
    expect(classifyFormPurpose(signals({ actionPath: "/search" }))).toBe("search");
    expect(classifyFormPurpose(signals({ fieldTypes: ["search"] }))).toBe("search");
  });

  it("detects checkout from path, button, or card field names", () => {
    expect(classifyFormPurpose(signals({ actionPath: "/checkout/confirm" }))).toBe("checkout");
    expect(classifyFormPurpose(signals({ buttonText: "Place order" }))).toBe("checkout");
    expect(classifyFormPurpose(signals({ fieldNames: ["cc-number"] }))).toBe("checkout");
  });

  it("detects upload, message, create, and update", () => {
    expect(classifyFormPurpose(signals({ fieldTypes: ["file"] }))).toBe("upload");
    expect(classifyFormPurpose(signals({ buttonText: "Send" }))).toBe("message");
    expect(classifyFormPurpose(signals({ fieldTypes: ["textarea"], fieldNames: ["comment"] }))).toBe("message");
    expect(classifyFormPurpose(signals({ actionPath: "/projects/new" }))).toBe("create");
    expect(classifyFormPurpose(signals({ buttonText: "Create project" }))).toBe("create");
    expect(classifyFormPurpose(signals({ actionPath: "/settings/profile", buttonText: "Save" }))).toBe("update");
    expect(classifyFormPurpose(signals({ method: "patch" }))).toBe("update");
  });

  it("ranks login above other signals and falls back to unknown", () => {
    expect(classifyFormPurpose(signals({ actionPath: "/checkout", fieldTypes: ["password"] }))).toBe("login");
    expect(classifyFormPurpose(signals({ buttonText: "Continue" }))).toBe("unknown");
  });
});
