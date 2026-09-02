import { describe, expect, it } from "vitest";
import { isDomainAllowlisted, originPatternsForDomain, registrableDomain, stripUrl } from "./url.js";

describe("stripUrl", () => {
  it("strips query string and fragment", () => {
    const result = stripUrl("https://app.example.com/docs/page?token=abc&x=1#section");
    expect(result).toEqual({
      domain: "example.com",
      host: "app.example.com",
      path: "/docs/page",
      href: "https://app.example.com/docs/page"
    });
  });

  it("strips embedded credentials", () => {
    const result = stripUrl("https://user:secret@example.com/path");
    expect(result?.href).toBe("https://example.com/path");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("keeps a non-default port and lower-cases the host", () => {
    expect(stripUrl("http://LocalHost.Example.com:8080/A/B")?.href).toBe("http://localhost.example.com:8080/A/B");
  });

  it("returns null for non-http schemes and garbage", () => {
    expect(stripUrl("chrome://extensions")).toBeNull();
    expect(stripUrl("file:///etc/passwd")).toBeNull();
    expect(stripUrl("not a url")).toBeNull();
  });

  it("caps very long paths", () => {
    const result = stripUrl(`https://example.com/${"a".repeat(2000)}`);
    expect(result?.path.length).toBe(512);
  });
});

describe("registrableDomain", () => {
  it("collapses subdomains to eTLD+1", () => {
    expect(registrableDomain("mail.google.com")).toBe("google.com");
    expect(registrableDomain("a.b.c.example.org")).toBe("example.org");
  });

  it("understands the small public suffix list", () => {
    expect(registrableDomain("www.bbc.co.uk")).toBe("bbc.co.uk");
    expect(registrableDomain("shop.example.com.au")).toBe("example.com.au");
    expect(registrableDomain("x.y.example.co.jp")).toBe("example.co.jp");
    expect(registrableDomain("news.example.com.br")).toBe("example.com.br");
    expect(registrableDomain("api.example.co.nz")).toBe("example.co.nz");
    expect(registrableDomain("charity.org.uk")).toBe("charity.org.uk");
  });

  it("returns bare hosts, IPs, and localhost unchanged", () => {
    expect(registrableDomain("localhost")).toBe("localhost");
    expect(registrableDomain("127.0.0.1")).toBe("127.0.0.1");
    expect(registrableDomain("Example.COM.")).toBe("example.com");
    expect(registrableDomain("")).toBe("");
  });
});

describe("isDomainAllowlisted", () => {
  it("matches subdomains of allowlisted registrable domains", () => {
    expect(isDomainAllowlisted("docs.example.com", ["example.com"])).toBe(true);
    expect(isDomainAllowlisted("example.com", ["www.example.com"])).toBe(true);
    expect(isDomainAllowlisted("evil-example.com", ["example.com"])).toBe(false);
    expect(isDomainAllowlisted("", ["example.com"])).toBe(false);
  });
});

describe("originPatternsForDomain", () => {
  it("emits explicit https and http patterns", () => {
    expect(originPatternsForDomain("Docs.Example.com")).toEqual(["https://*.example.com/*", "http://*.example.com/*"]);
  });

  it("rejects domains with pattern-breaking characters", () => {
    expect(originPatternsForDomain("exa mple.com/*")).toEqual([]);
    expect(originPatternsForDomain("")).toEqual([]);
  });
});
