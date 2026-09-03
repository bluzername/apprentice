#!/usr/bin/env node
/**
 * Build offline GUI-grounding cases from the windows that are open right now.
 *
 * For each requested app this reads the front window's accessibility tree
 * through System Events (never by talking to the app itself, which hangs for
 * TCC-restricted apps such as Notes and Preview), captures that window region
 * with `screencapture -x -R`, and writes a manifest of instruction plus
 * ground-truth rectangle pairs in image pixels:
 *
 *   { cases: [{ id, app, image, imageWidth, imageHeight, instruction,
 *               rect: { x, y, width, height }, role, label, expectedAction }] }
 *
 * The manifest feeds packages/model-adapters/bench/grounding-eval.test.ts.
 *
 * Usage:
 *   node scripts/make-grounding-cases.mjs [options]
 *     --apps Finder,TextEdit,Preview,Notes,Apprentice   apps to sample
 *     --out  dist/grounding-cases                       output directory
 *     --max-per-window 12                               cases per window
 *     --min-size 8                                      smallest side in points
 *     --max-area-ratio 0.5                              largest share of the window
 *     --depth 6                                         accessibility recursion depth
 *     --max-records 400                                 elements read per window
 *     --max-children 40                                 children walked per container
 *     --timeout-ms 45000                                per-app System Events budget
 *
 * Nothing is clicked, focused or moved: the accessibility tree is read and the
 * screen is captured. Whatever is visually on top of the window region is what
 * lands in the PNG, so run this with the sampled windows unobstructed.
 */
import { execFile, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_APPS = ["Finder", "TextEdit", "Preview", "Notes", "Apprentice"];
/** ASCII unit/record separators: element names may contain tabs and newlines. */
const UNIT_SEP = "\u001f";
const RECORD_SEP = "\u001e";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Longer accessibility text is a paragraph, not a label a user would point at. */
const MAX_LABEL_LENGTH = 60;

/**
 * Roles that make a usable grounding target, with the instruction phrasing and
 * the action a human would take. Anything not listed here is ignored.
 */
const ROLE_TARGETS = {
  AXButton: { action: "click", noun: "button" },
  AXPopUpButton: { action: "click", noun: "pop-up button" },
  AXMenuButton: { action: "click", noun: "menu button" },
  AXMenuItem: { action: "click", noun: "menu item" },
  AXCheckBox: { action: "click", noun: "checkbox" },
  AXRadioButton: { action: "click", noun: "tab" },
  AXTextField: { action: "click", noun: "text field" },
  AXSearchField: { action: "click", noun: "search field" },
  AXLink: { action: "click", noun: "link" },
  AXRow: { action: "double_click", noun: "" },
  AXCell: { action: "double_click", noun: "" },
  AXStaticText: { action: "click", noun: "" }
};

/** Natural phrasing, without repeating a role noun the label already carries. */
export function instructionFor(role, label) {
  const target = ROLE_TARGETS[role];
  if (target.action === "double_click") {
    return /\.[A-Za-z0-9]{1,5}$/.test(label) ? `Double-click the file "${label}" in the list` : `Double-click "${label}" in the list`;
  }
  if (target.noun.length === 0) {
    return `Click "${label}"`;
  }
  if (label.toLowerCase().endsWith(target.noun)) {
    return `Click the "${label}"`;
  }
  return `Click the "${label}" ${target.noun}`;
}

/**
 * Recursive System Events walk. `entire contents` returns an empty list for
 * several apps (Finder among them), so children are fetched level by level and
 * every property of one level comes back in a single Apple event.
 */
const AX_SCRIPT = `property unitSep : (character id 31)
property recSep : (character id 30)
property collected : 0
property maxRecords : 400
property maxKids : 40

on textOf(v)
  if v is missing value then return ""
  try
    return v as text
  on error
    return ""
  end try
end textOf

on collect(elemRef, depth, maxDepth)
  set acc to ""
  if depth > maxDepth then return acc
  if collected >= maxRecords then return acc
  tell application "System Events"
    try
      set kids to UI elements of elemRef
    on error
      return acc
    end try
    set n to count of kids
    if n is 0 then return acc
    if n > maxKids then set n to maxKids
    try
      set roles to role of (UI elements 1 thru n of elemRef)
      set names to name of (UI elements 1 thru n of elemRef)
      set titles to title of (UI elements 1 thru n of elemRef)
      set descs to description of (UI elements 1 thru n of elemRef)
      set poss to position of (UI elements 1 thru n of elemRef)
      set sizes to size of (UI elements 1 thru n of elemRef)
    on error
      return acc
    end try
  end tell
  repeat with i from 1 to n
    if collected >= maxRecords then return acc
    try
      set p to item i of poss
      set s to item i of sizes
      if p is not missing value and s is not missing value then
        set acc to acc & my textOf(item i of roles) & unitSep & my textOf(item i of names) & unitSep & my textOf(item i of titles) & unitSep & my textOf(item i of descs) & unitSep & (item 1 of p) & unitSep & (item 2 of p) & unitSep & (item 1 of s) & unitSep & (item 2 of s) & recSep
        set collected to collected + 1
      end if
    end try
    try
      set acc to acc & my collect(item i of kids, depth + 1, maxDepth)
    end try
  end repeat
  return acc
end collect

on run argv
  set appName to item 1 of argv
  set maxDepth to (item 2 of argv) as integer
  set maxRecords to (item 3 of argv) as integer
  set maxKids to (item 4 of argv) as integer
  set collected to 0
  tell application "System Events"
    if not (exists process appName) then error "process not running"
    tell process appName
      if (count of windows) is 0 then error "no window"
      set w to window 1
      set wname to ""
      try
        set wname to name of w
      end try
      set p to position of w
      set s to size of w
    end tell
  end tell
  set header to "WINDOW" & unitSep & wname & unitSep & "" & unitSep & "" & unitSep & (item 1 of p) & unitSep & (item 2 of p) & unitSep & (item 1 of s) & unitSep & (item 2 of s) & recSep
  tell application "System Events" to tell process appName to set w to window 1
  return header & my collect(w, 0, maxDepth)
end run
`;

export function parseArgs(argv) {
  const options = {
    apps: DEFAULT_APPS,
    out: "dist/grounding-cases",
    maxPerWindow: 12,
    minSize: 8,
    maxAreaRatio: 0.5,
    depth: 6,
    maxRecords: 400,
    maxChildren: 40,
    timeoutMs: 45000
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (value === undefined) {
      throw new Error(`missing value for ${flag}`);
    }
    switch (flag) {
      case "--apps":
        options.apps = value.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
        break;
      case "--out":
        options.out = value;
        break;
      case "--max-per-window":
        options.maxPerWindow = positiveInt(flag, value);
        break;
      case "--min-size":
        options.minSize = positiveInt(flag, value);
        break;
      case "--max-area-ratio":
        options.maxAreaRatio = positiveNumber(flag, value);
        break;
      case "--depth":
        options.depth = positiveInt(flag, value);
        break;
      case "--max-records":
        options.maxRecords = positiveInt(flag, value);
        break;
      case "--max-children":
        options.maxChildren = positiveInt(flag, value);
        break;
      case "--timeout-ms":
        options.timeoutMs = positiveInt(flag, value);
        break;
      default:
        throw new Error(`unknown option ${flag}`);
    }
    index += 1;
  }
  if (options.apps.length === 0) {
    throw new Error("--apps needs at least one app name");
  }
  return options;
}

function positiveInt(flag, value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} needs a positive integer, got ${value}`);
  }
  return parsed;
}

function positiveNumber(flag, value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} needs a positive number, got ${value}`);
  }
  return parsed;
}

/**
 * Run one AppleScript through `osascript -` with a hard timeout: an app whose
 * accessibility bridge is blocked (Notes behind a pending TCC prompt) never
 * answers, and must not stall the whole run.
 */
function runOsascript(script, args, timeoutMs) {
  return new Promise((resolvePromise) => {
    const child = spawn("osascript", ["-", ...args], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        child.kill("SIGKILL");
      }
    }, timeoutMs);
    timer.unref?.();
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(result);
    };
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => finish({ ok: false, reason: `osascript failed to start: ${error.message}` }));
    child.on("close", (code, signal) => {
      if (signal === "SIGKILL") {
        finish({ ok: false, reason: `System Events did not answer within ${timeoutMs} ms` });
        return;
      }
      if (code !== 0) {
        finish({ ok: false, reason: stderr.trim().split("\n").pop() ?? `osascript exited with ${code}` });
        return;
      }
      finish({ ok: true, text: stdout });
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(script);
  });
}

/** Every visible process except the sampled app, with the bounds of its windows. */
const OTHER_WINDOWS_SCRIPT = `property unitSep : (character id 31)
property recSep : (character id 30)

on run argv
  set target to item 1 of argv
  set acc to ""
  tell application "System Events"
    set frontName to ""
    try
      set frontName to name of first process whose frontmost is true
    end try
    repeat with p in (every process whose visible is true)
      set pname to name of p
      if pname is not target then
        try
          repeat with w in (every window of p)
            set wp to position of w
            set ws to size of w
            if wp is not missing value and ws is not missing value then
              set acc to acc & pname & unitSep & (pname is frontName) & unitSep & (item 1 of wp) & unitSep & (item 2 of wp) & unitSep & (item 1 of ws) & unitSep & (item 2 of ws) & recSep
            end if
          end repeat
        end try
      end if
    end repeat
  end tell
  return acc
end run
`;

function readAccessibilityTree(app, options) {
  return runOsascript(AX_SCRIPT, [app, String(options.depth), String(options.maxRecords), String(options.maxChildren)], options.timeoutMs);
}

export function intersectionRatio(bounds, other) {
  const width = Math.min(bounds.x + bounds.width, other.x + other.width) - Math.max(bounds.x, other.x);
  const height = Math.min(bounds.y + bounds.height, other.y + other.height) - Math.max(bounds.y, other.y);
  if (width <= 0 || height <= 0) {
    return 0;
  }
  return (width * height) / (bounds.width * bounds.height);
}

/**
 * `screencapture -R` records whatever is visually on top of the region, so a
 * window covered by another app produces ground-truth rectangles that point at
 * the wrong pixels. Full z-order is not readable from System Events, so every
 * overlapping window of another visible app is reported as a risk.
 */
async function detectOverlaps(app, bounds, timeoutMs) {
  const result = await runOsascript(OTHER_WINDOWS_SCRIPT, [app], timeoutMs);
  if (!result.ok) {
    return { known: false, overlaps: [], reason: result.reason };
  }
  const worst = new Map();
  for (const chunk of result.text.split(RECORD_SEP)) {
    const fields = chunk.split(UNIT_SEP);
    if (fields.length !== 6) continue;
    const other = { x: Number(fields[2]), y: Number(fields[3]), width: Number(fields[4]), height: Number(fields[5]) };
    if ([other.x, other.y, other.width, other.height].some((value) => !Number.isFinite(value))) continue;
    const ratio = intersectionRatio(bounds, other);
    if (ratio <= 0.01) continue;
    const entry = { app: fields[0], frontmost: fields[1] === "true", ratio: Number(ratio.toFixed(3)) };
    const current = worst.get(entry.app);
    if (current === undefined || current.ratio < entry.ratio) {
      worst.set(entry.app, entry);
    }
  }
  return { known: true, overlaps: [...worst.values()].sort((a, b) => b.ratio - a.ratio) };
}

export function parseRecords(text) {
  const records = [];
  for (const chunk of text.split(RECORD_SEP)) {
    const fields = chunk.split(UNIT_SEP);
    if (fields.length !== 8) continue;
    const [role, name, title, description, x, y, width, height] = fields;
    const numbers = [Number(x), Number(y), Number(width), Number(height)];
    if (numbers.some((value) => !Number.isFinite(value))) continue;
    records.push({
      role: role.trim(),
      name: name.trim(),
      title: title.trim(),
      description: description.trim(),
      x: numbers[0],
      y: numbers[1],
      width: numbers[2],
      height: numbers[3]
    });
  }
  return records;
}

/** Descriptions that only restate the role carry no information for an instruction. */
export function isGenericDescription(description, role) {
  const normalized = description.toLowerCase();
  if (normalized.length === 0) return true;
  const generic = new Set([
    "text", "cell", "group", "image", "split group", "scroll area", "outline row", "toolbar", "button",
    "list", "table", "row", "column", "link", "checkbox", "radio button", "text field", "text entry area",
    "menu item", "menu", "pop up button", "tab group", "web area", "unknown", "static text"
  ]);
  if (generic.has(normalized)) return true;
  return normalized === role.replace(/^AX/, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

/** Single-line label; multi-line accessibility text makes an unusable instruction. */
export function labelFor(record) {
  const raw = record.name.length > 0 ? record.name : record.title.length > 0 ? record.title : isGenericDescription(record.description, record.role) ? "" : record.description;
  return raw.replace(/\s+/g, " ").trim();
}

export function readPngDimensions(png) {
  if (png.length < 24 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (png.toString("ascii", 12, 16) !== "IHDR") return null;
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

async function captureWindow(bounds, file) {
  const region = `${Math.round(bounds.x)},${Math.round(bounds.y)},${Math.round(bounds.width)},${Math.round(bounds.height)}`;
  await execFileAsync("screencapture", ["-x", "-R", region, file]);
  const dims = readPngDimensions(readFileSync(file));
  if (!dims) {
    throw new Error(`screencapture did not write a PNG to ${file}`);
  }
  return dims;
}

/** Keep the first element per label, drop anything that is not a precise target. */
export function selectElements(records, window, options) {
  const windowArea = window.width * window.height;
  const seen = new Set();
  const kept = [];
  for (const record of records) {
    const target = ROLE_TARGETS[record.role];
    if (target === undefined) continue;
    if (record.width < options.minSize || record.height < options.minSize) continue;
    if (record.x < window.x || record.y < window.y) continue;
    if (record.x + record.width > window.x + window.width) continue;
    if (record.y + record.height > window.y + window.height) continue;
    if (windowArea > 0 && (record.width * record.height) / windowArea > options.maxAreaRatio) continue;
    const label = labelFor(record);
    if (label.length === 0 || label.length > MAX_LABEL_LENGTH) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push({ ...record, label, action: target.action, instruction: instructionFor(record.role, label) });
  }
  return kept;
}

/** Round-robin over roles (alphabetical, tree order inside a role) up to the cap. */
export function spreadAcrossRoles(elements, cap) {
  const buckets = new Map();
  for (const element of elements) {
    const bucket = buckets.get(element.role) ?? [];
    bucket.push(element);
    buckets.set(element.role, bucket);
  }
  const roles = [...buckets.keys()].sort();
  const picked = [];
  let round = 0;
  while (picked.length < cap) {
    let addedThisRound = 0;
    for (const role of roles) {
      if (picked.length >= cap) break;
      const candidate = buckets.get(role)?.[round];
      if (candidate !== undefined) {
        picked.push(candidate);
        addedThisRound += 1;
      }
    }
    if (addedThisRound === 0) break;
    round += 1;
  }
  return picked;
}

export function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "app";
}

async function collectApp(app, options, outDir) {
  const tree = await readAccessibilityTree(app, options);
  if (!tree.ok) {
    return { cases: [], skipped: { app, reason: tree.reason } };
  }
  const records = parseRecords(tree.text);
  const header = records[0];
  if (header === undefined || header.role !== "WINDOW") {
    return { cases: [], skipped: { app, reason: "no window bounds returned by System Events" } };
  }
  const window = { x: header.x, y: header.y, width: header.width, height: header.height };
  if (window.width < 40 || window.height < 40) {
    return { cases: [], skipped: { app, reason: `front window is only ${window.width}x${window.height} points` } };
  }
  const appSlug = slug(app);
  const imageName = `${appSlug}.png`;
  let image;
  try {
    image = await captureWindow(window, join(outDir, imageName));
  } catch (error) {
    return { cases: [], skipped: { app, reason: `screencapture failed: ${error instanceof Error ? error.message : String(error)}` } };
  }
  const occlusion = await detectOverlaps(app, window, Math.min(options.timeoutMs, 15000));
  const scaleX = image.width / window.width;
  const scaleY = image.height / window.height;
  const selected = spreadAcrossRoles(selectElements(records.slice(1), window, options), options.maxPerWindow);
  const cases = selected.map((element, index) => ({
    id: `${appSlug}-${index + 1}`,
    app,
    image: imageName,
    imageWidth: image.width,
    imageHeight: image.height,
    instruction: element.instruction,
    rect: {
      x: Math.round((element.x - window.x) * scaleX),
      y: Math.round((element.y - window.y) * scaleY),
      width: Math.round(element.width * scaleX),
      height: Math.round(element.height * scaleY)
    },
    role: element.role,
    label: element.label,
    expectedAction: element.action
  }));
  return {
    cases,
    window: {
      app,
      title: header.name,
      bounds: window,
      image: imageName,
      imageWidth: image.width,
      imageHeight: image.height,
      scaleX,
      scaleY,
      elementsSeen: records.length - 1,
      elementsUsable: selected.length,
      overlappingWindows: occlusion.overlaps,
      overlapCheck: occlusion.known ? "ok" : `unavailable: ${occlusion.reason}`
    },
    ...(cases.length === 0 ? { skipped: { app, reason: "no usable accessibility targets in the front window" } } : {})
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outDir = isAbsolute(options.out) ? options.out : resolve(process.cwd(), options.out);
  mkdirSync(outDir, { recursive: true });
  const cases = [];
  const windows = [];
  const skipped = [];
  for (const app of options.apps) {
    process.stdout.write(`reading ${app} ... `);
    const result = await collectApp(app, options, outDir);
    if (result.window !== undefined) {
      windows.push(result.window);
    }
    if (result.skipped !== undefined) {
      skipped.push(result.skipped);
      process.stdout.write(`skipped (${result.skipped.reason})\n`);
    } else {
      const overlaps = result.window?.overlappingWindows ?? [];
      const warning = overlaps.length === 0 ? "" : ` WARNING: window may be covered by ${overlaps.slice(0, 3).map((entry) => `${entry.app} ${Math.round(entry.ratio * 100)}%`).join(", ")}`;
      process.stdout.write(`${result.cases.length} cases${warning}\n`);
    }
    cases.push(...result.cases);
  }
  const manifestPath = join(outDir, "cases.json");
  const manifest = {
    generatedAt: new Date().toISOString(),
    generator: basename(new URL(import.meta.url).pathname),
    options: { apps: options.apps, maxPerWindow: options.maxPerWindow, minSize: options.minSize, maxAreaRatio: options.maxAreaRatio, depth: options.depth, maxRecords: options.maxRecords, maxChildren: options.maxChildren },
    windows,
    skipped,
    cases
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\n${cases.length} cases from ${windows.length} window(s) -> ${manifestPath}`);
  if (skipped.length > 0) {
    for (const entry of skipped) {
      console.log(`  skipped ${entry.app}: ${entry.reason}`);
    }
  }
  if (cases.length === 0) {
    process.exitCode = 1;
  }
}

/** Only run the capture when invoked as a CLI; the tests import the helpers. */
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
