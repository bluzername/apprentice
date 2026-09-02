import { describe, expect, it } from "vitest";
import {
  accessibleName,
  closestInteractive,
  describeElement,
  elementRole,
  fingerprint,
  structuralPath,
  type DomLookup,
  type ElementLike
} from "./descriptor.js";

interface FakeOptions {
  readonly tag: string;
  readonly id?: string;
  readonly attrs?: Record<string, string>;
  readonly text?: string;
  readonly labels?: readonly ElementLike[];
}

class FakeElement implements ElementLike {
  readonly tagName: string;
  readonly id: string;
  readonly ownText: string | undefined;
  readonly labels: readonly ElementLike[] | null;
  readonly attrs: Record<string, string>;
  parentElement: FakeElement | null = null;
  readonly childList: FakeElement[] = [];

  constructor(options: FakeOptions) {
    this.tagName = options.tag.toUpperCase();
    this.id = options.id ?? "";
    this.ownText = options.text;
    this.labels = options.labels ? [...options.labels] : null;
    this.attrs = { ...(options.attrs ?? {}) };
  }

  get children(): ArrayLike<ElementLike> {
    return this.childList;
  }

  /** Mirrors the DOM: text of the element plus all descendants. */
  get innerText(): string {
    return [this.ownText ?? "", ...this.childList.map((child) => child.innerText)].join(" ");
  }

  get textContent(): string | null {
    return this.innerText;
  }

  getAttribute(name: string): string | null {
    return name in this.attrs ? (this.attrs[name] ?? null) : null;
  }

  append(...children: FakeElement[]): this {
    for (const child of children) {
      child.parentElement = this;
      this.childList.push(child);
    }
    return this;
  }
}

function tree(): { root: FakeElement; button: FakeElement; span: FakeElement; input: FakeElement } {
  const span = new FakeElement({ tag: "span", text: "  Save   changes " });
  const button = new FakeElement({ tag: "button", attrs: { "data-testid": "save-btn" } }).append(span);
  const label = new FakeElement({ tag: "label", text: "Email address" });
  const input = new FakeElement({ tag: "input", attrs: { type: "email", name: "email" }, labels: [label] });
  const form = new FakeElement({ tag: "form" }).append(label, input, button);
  const main = new FakeElement({ tag: "main" }).append(new FakeElement({ tag: "h1", text: "Title" }), form);
  const root = new FakeElement({ tag: "body" }).append(main);
  return { root, button, span, input };
}

describe("elementRole", () => {
  it("prefers explicit role attributes", () => {
    expect(elementRole(new FakeElement({ tag: "div", attrs: { role: "button" } }))).toBe("button");
  });

  it("maps implicit roles for common tags and input types", () => {
    expect(elementRole(new FakeElement({ tag: "a", attrs: { href: "/x" } }))).toBe("link");
    expect(elementRole(new FakeElement({ tag: "a" }))).toBeUndefined();
    expect(elementRole(new FakeElement({ tag: "input", attrs: { type: "checkbox" } }))).toBe("checkbox");
    expect(elementRole(new FakeElement({ tag: "input" }))).toBe("textbox");
    expect(elementRole(new FakeElement({ tag: "h2" }))).toBe("heading");
    expect(elementRole(new FakeElement({ tag: "div" }))).toBeUndefined();
  });
});

describe("accessibleName", () => {
  it("resolves aria-labelledby through the lookup", () => {
    const heading = new FakeElement({ tag: "h2", id: "dlg-title", text: "Confirm delete" });
    const lookup: DomLookup = { byId: (id) => (id === "dlg-title" ? heading : null) };
    const dialog = new FakeElement({ tag: "div", attrs: { role: "dialog", "aria-labelledby": "dlg-title" } });
    expect(accessibleName(dialog, lookup)).toBe("Confirm delete");
  });

  it("falls back through aria-label, label, title, alt, and text", () => {
    expect(accessibleName(new FakeElement({ tag: "button", attrs: { "aria-label": "Close" }, text: "x" }))).toBe("Close");
    expect(accessibleName(tree().input)).toBe("Email address");
    expect(accessibleName(new FakeElement({ tag: "img", attrs: { alt: "Logo" } }))).toBe("Logo");
    expect(accessibleName(new FakeElement({ tag: "a", attrs: { title: "Home", href: "/" }, text: "Go" }))).toBe("Home");
    expect(accessibleName(new FakeElement({ tag: "button", text: "  Save   changes " }))).toBe("Save changes");
  });

  it("uses placeholder for inputs but never their text content", () => {
    const input = new FakeElement({ tag: "input", attrs: { placeholder: "Search" }, text: "typed secret" });
    expect(accessibleName(input)).toBe("Search");
    expect(describeElement(input).text).toBeUndefined();
  });

  it("truncates text to 80 characters", () => {
    const long = new FakeElement({ tag: "p", text: "x".repeat(200) });
    expect(accessibleName(long)?.length).toBe(80);
  });
});

describe("structuralPath and fingerprint", () => {
  it("builds an nth-child path capped at 6 levels", () => {
    const { span } = tree();
    expect(structuralPath(span)).toBe("body:0>main:0>form:1>button:2>span:0");
    let deep = new FakeElement({ tag: "div" });
    for (let level = 0; level < 10; level += 1) {
      deep = new FakeElement({ tag: "div" }).append(deep);
    }
    let leaf: FakeElement = deep;
    while (leaf.childList[0]) {
      leaf = leaf.childList[0];
    }
    expect(structuralPath(leaf).split(">")).toHaveLength(6);
  });

  it("is stable for identical structure and changes when position or identity changes", () => {
    const first = tree();
    const second = tree();
    expect(fingerprint(first.button)).toBe(fingerprint(second.button));
    expect(fingerprint(first.button)).toMatch(/^[0-9a-f]{8}$/);
    const other = new FakeElement({ tag: "button", attrs: { "data-testid": "cancel-btn" } });
    first.button.parentElement?.append(other);
    expect(fingerprint(other)).not.toBe(fingerprint(first.button));
  });
});

describe("describeElement", () => {
  it("produces a schema-shaped descriptor without undefined keys", () => {
    const { button } = tree();
    const descriptor = describeElement(button);
    expect(descriptor).toEqual({
      tag: "button",
      role: "button",
      name: "Save changes",
      text: "Save changes",
      identifier: "save-btn",
      fingerprint: expect.stringMatching(/^[0-9a-f]{8}$/)
    });
    expect(Object.values(descriptor).every((value) => value !== undefined)).toBe(true);
  });

  it("resolves clicks on inner spans to the interactive ancestor", () => {
    const { button, span } = tree();
    expect(closestInteractive(span)).toBe(button);
    const plain = new FakeElement({ tag: "div" });
    expect(closestInteractive(plain)).toBe(plain);
  });
});
