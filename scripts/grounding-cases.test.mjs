/**
 * Pure-logic tests for scripts/make-grounding-cases.mjs. Importing the module
 * does not touch the accessibility API or the screen: the capture only runs
 * when the file is invoked as a CLI.
 */
import { describe, expect, it } from "vitest";
import {
  instructionFor,
  intersectionRatio,
  labelFor,
  parseArgs,
  parseRecords,
  readPngDimensions,
  selectElements,
  slug,
  spreadAcrossRoles
} from "./make-grounding-cases.mjs";

const UNIT = "\u001f";
const RECORD = "\u001e";
const WINDOW = { x: 100, y: 100, width: 800, height: 600 };
const OPTIONS = { minSize: 8, maxAreaRatio: 0.5 };

function record(fields) {
  return [fields.role, fields.name ?? "", fields.title ?? "", fields.description ?? "", fields.x, fields.y, fields.width, fields.height].join(UNIT);
}

function element(overrides) {
  return { role: "AXButton", name: "Save", title: "", description: "", x: 200, y: 200, width: 60, height: 30, ...overrides };
}

describe("parseArgs", () => {
  it("defaults to the five sampled apps", () => {
    expect(parseArgs([]).apps).toEqual(["Finder", "TextEdit", "Preview", "Notes", "Apprentice"]);
  });

  it("parses an app list and a cap", () => {
    const options = parseArgs(["--apps", "Finder, Notes", "--max-per-window", "3"]);
    expect(options.apps).toEqual(["Finder", "Notes"]);
    expect(options.maxPerWindow).toBe(3);
  });

  it("rejects an unknown flag", () => {
    expect(() => parseArgs(["--nope", "1"])).toThrow(/unknown option/);
  });

  it("rejects a flag without a value", () => {
    expect(() => parseArgs(["--depth"])).toThrow(/missing value/);
  });

  it("rejects a non-positive number", () => {
    expect(() => parseArgs(["--depth", "0"])).toThrow(/positive integer/);
    expect(() => parseArgs(["--max-area-ratio", "-1"])).toThrow(/positive number/);
  });

  it("rejects an empty app list", () => {
    expect(() => parseArgs(["--apps", " , "])).toThrow(/at least one app/);
  });
});

describe("parseRecords", () => {
  it("parses well-formed records and drops malformed ones", () => {
    const text = [record({ role: "AXButton", name: "Save", x: 1, y: 2, width: 3, height: 4 }), "toofew", record({ role: "AXRow", x: 5, y: 6, width: 7, height: 8 })].join(RECORD);
    expect(parseRecords(text)).toEqual([
      { role: "AXButton", name: "Save", title: "", description: "", x: 1, y: 2, width: 3, height: 4 },
      { role: "AXRow", name: "", title: "", description: "", x: 5, y: 6, width: 7, height: 8 }
    ]);
  });

  it("drops records whose geometry is not numeric", () => {
    expect(parseRecords(record({ role: "AXButton", name: "Save", x: "a", y: 2, width: 3, height: 4 }))).toEqual([]);
  });
});

describe("labelFor", () => {
  it("prefers the name, then the title, then a non-generic description", () => {
    expect(labelFor(element({ name: "Save", title: "T", description: "D" }))).toBe("Save");
    expect(labelFor(element({ name: "", title: "T", description: "D" }))).toBe("T");
    expect(labelFor(element({ name: "", title: "", description: "close button" }))).toBe("close button");
  });

  it("drops a description that only restates the role", () => {
    expect(labelFor(element({ role: "AXStaticText", name: "", title: "", description: "text" }))).toBe("");
    expect(labelFor(element({ role: "AXCheckBox", name: "", title: "", description: "checkbox" }))).toBe("");
  });

  it("collapses multi-line accessibility text to one line", () => {
    expect(labelFor(element({ name: "first\n  second   third" }))).toBe("first second third");
  });
});

describe("instructionFor", () => {
  it("phrases a button click", () => {
    expect(instructionFor("AXButton", "Save shortcut")).toBe('Click the "Save shortcut" button');
  });

  it("does not repeat a role noun the label already carries", () => {
    expect(instructionFor("AXButton", "close button")).toBe('Click the "close button"');
  });

  it("calls a list row with a file extension a file", () => {
    expect(instructionFor("AXCell", "invoice-INV-1102.pdf")).toBe('Double-click the file "invoice-INV-1102.pdf" in the list');
    expect(instructionFor("AXRow", "Documents")).toBe('Double-click "Documents" in the list');
  });

  it("keeps static text plain", () => {
    expect(instructionFor("AXStaticText", "Favourites")).toBe('Click "Favourites"');
  });
});

describe("selectElements", () => {
  it("keeps a normal interactive element", () => {
    const kept = selectElements([element({})], WINDOW, OPTIONS);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ label: "Save", action: "click", instruction: 'Click the "Save" button' });
  });

  it("skips roles that are not grounding targets", () => {
    expect(selectElements([element({ role: "AXImage" })], WINDOW, OPTIONS)).toHaveLength(0);
  });

  it("skips elements smaller than the minimum size", () => {
    expect(selectElements([element({ width: 7, height: 30 })], WINDOW, OPTIONS)).toHaveLength(0);
    expect(selectElements([element({ width: 30, height: 7 })], WINDOW, OPTIONS)).toHaveLength(0);
  });

  it("skips elements that fall outside the window", () => {
    expect(selectElements([element({ x: 90 })], WINDOW, OPTIONS)).toHaveLength(0);
    expect(selectElements([element({ y: 90 })], WINDOW, OPTIONS)).toHaveLength(0);
    expect(selectElements([element({ x: 880, width: 60 })], WINDOW, OPTIONS)).toHaveLength(0);
    expect(selectElements([element({ y: 690, height: 30 })], WINDOW, OPTIONS)).toHaveLength(0);
  });

  it("skips containers that cover most of the window", () => {
    expect(selectElements([element({ width: 700, height: 500 })], WINDOW, OPTIONS)).toHaveLength(0);
  });

  it("skips elements without a usable name", () => {
    expect(selectElements([element({ name: "", description: "button" })], WINDOW, OPTIONS)).toHaveLength(0);
  });

  it("skips a label that is a paragraph rather than a name", () => {
    expect(selectElements([element({ name: "x".repeat(61) })], WINDOW, OPTIONS)).toHaveLength(0);
  });

  it("keeps the first element of a duplicated name", () => {
    const kept = selectElements([element({ y: 200 }), element({ y: 300 }), element({ name: "save", y: 400 })], WINDOW, OPTIONS);
    expect(kept).toHaveLength(1);
    expect(kept[0].y).toBe(200);
  });
});

describe("spreadAcrossRoles", () => {
  const elements = [
    { role: "AXButton", label: "b1" },
    { role: "AXButton", label: "b2" },
    { role: "AXButton", label: "b3" },
    { role: "AXCell", label: "c1" },
    { role: "AXCell", label: "c2" }
  ];

  it("round-robins across roles in alphabetical order", () => {
    expect(spreadAcrossRoles(elements, 4).map((entry) => entry.label)).toEqual(["b1", "c1", "b2", "c2"]);
  });

  it("falls back to the remaining role once one is exhausted", () => {
    expect(spreadAcrossRoles(elements, 5).map((entry) => entry.label)).toEqual(["b1", "c1", "b2", "c2", "b3"]);
  });

  it("never returns more than the cap and is deterministic", () => {
    expect(spreadAcrossRoles(elements, 2).map((entry) => entry.label)).toEqual(["b1", "c1"]);
    expect(spreadAcrossRoles(elements, 99)).toHaveLength(5);
    expect(spreadAcrossRoles([], 5)).toEqual([]);
  });
});

describe("intersectionRatio", () => {
  it("is 0 for disjoint rectangles", () => {
    expect(intersectionRatio(WINDOW, { x: 2000, y: 2000, width: 10, height: 10 })).toBe(0);
  });

  it("is 1 when the other window covers the whole target", () => {
    expect(intersectionRatio(WINDOW, { x: 0, y: 0, width: 4000, height: 4000 })).toBe(1);
  });

  it("is the covered share for a partial overlap", () => {
    expect(intersectionRatio(WINDOW, { x: 500, y: 100, width: 400, height: 600 })).toBeCloseTo(0.5, 10);
  });
});

describe("readPngDimensions", () => {
  it("reads the IHDR size", () => {
    const png = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
    png.write("IHDR", 12, "ascii");
    png.writeUInt32BE(1400, 16);
    png.writeUInt32BE(960, 20);
    expect(readPngDimensions(png)).toEqual({ width: 1400, height: 960 });
  });

  it("returns null for anything that is not a PNG", () => {
    expect(readPngDimensions(Buffer.alloc(24))).toBeNull();
    expect(readPngDimensions(Buffer.alloc(4))).toBeNull();
  });
});

describe("slug", () => {
  it("makes a filesystem-safe id", () => {
    expect(slug("TextEdit")).toBe("textedit");
    expect(slug("My App 2.0")).toBe("my-app-2-0");
    expect(slug("!!!")).toBe("app");
  });
});
