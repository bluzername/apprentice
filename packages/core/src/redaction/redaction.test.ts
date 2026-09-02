import { describe, expect, it } from "vitest";
import { redactText } from "./redact-text.js";
import { registrableDomain, stripUrl } from "./url.js";

describe("redactText", () => {
  it("masks emails, phones, cards, ssn, uuids and ids", () => {
    const result = redactText("Contact jane.doe@example.com or +1 (555) 123-4567 today");
    expect(result.text).toBe("Contact [email] or [phone] today");
    expect(result.removed).toEqual(["email", "phone"]);

    const card = redactText("Card 4111 1111 1111 1111 on file");
    expect(card.text).toBe("Card [card] on file");
    expect(card.removed).toContain("card");

    const iban = redactText("IBAN DE89 3704 0044 0532 0130 00 ok");
    expect(iban.text).toContain("[iban]");

    const ssn = redactText("SSN 123-45-6789");
    expect(ssn.text).toBe("SSN [ssn]");

    const uuid = redactText("id 3f9d2c1e-1b2a-4c3d-9e8f-123456789abc done");
    expect(uuid.text).toBe("id [uuid] done");
    expect(uuid.removed).toEqual(["uuid"]);

    const numeric = redactText("Order 9876543210");
    expect(numeric.text).toBe("Order [id]");
    expect(numeric.removed).toEqual(["numeric_id"]);
  });

  it("strips url query strings but keeps the base url", () => {
    const result = redactText("See https://crm.example/contact/1?token=abc#frag now");
    expect(result.text).toBe("See https://crm.example/contact/1 now");
    expect(result.removed).toEqual(["url_query"]);
  });

  it("masks person names but keeps common UI labels", () => {
    expect(redactText("Meeting with Alice Johnson").text).toBe("Meeting with [name]");
    expect(redactText("Meeting with Alice Johnson").removed).toEqual(["person_name"]);
    expect(redactText("Save Draft").text).toBe("Save Draft");
    expect(redactText("Sign In").text).toBe("Sign In");
    expect(redactText("New Contact").text).toBe("New Contact");
    expect(redactText("Log Activity").removed).toEqual([]);
  });

  it("leaves clean text untouched", () => {
    const result = redactText("Click the Save button");
    expect(result.text).toBe("Click the Save button");
    expect(result.removed).toEqual([]);
    expect(redactText("Year 2026 report").text).toBe("Year 2026 report");
  });
});

describe("stripUrl", () => {
  it("lowercases and drops query, fragment and credentials", () => {
    expect(stripUrl("HTTPS://User:Pass@CRM.Example/Contact/1?x=1#y")).toEqual({ domain: "crm.example", path: "/contact/1" });
    expect(stripUrl("crm.example/deals")).toEqual({ domain: "crm.example", path: "/deals" });
    expect(stripUrl("https://xn--bcher-kva.example/")).toEqual({ domain: "xn--bcher-kva.example", path: "/" });
    expect(stripUrl("https://bücher.example/")).toEqual({ domain: "xn--bcher-kva.example", path: "/" });
    expect(() => stripUrl("")).toThrow();
    expect(() => stripUrl("http://")).toThrow();
  });
});

describe("registrableDomain", () => {
  it("handles public suffixes", () => {
    expect(registrableDomain("app.crm.example.co.uk")).toBe("example.co.uk");
    expect(registrableDomain("shop.example.com.au")).toBe("example.com.au");
    expect(registrableDomain("app.crm.example")).toBe("crm.example");
    expect(registrableDomain("mail.google.com")).toBe("google.com");
    expect(registrableDomain("localhost")).toBe("localhost");
    expect(registrableDomain("user.github.io")).toBe("user.github.io");
  });
});
