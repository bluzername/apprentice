import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatDuration,
  formatHours,
  formatMinutes,
  formatPercent,
  formatRelative,
  fromDatetimeLocal,
  hourKey,
  humanize,
  isRunActive,
  menuBarStatusLabel,
  pluralize,
  riskLabel,
  riskTone,
  toDatetimeLocal
} from "./format";

describe("formatDuration", () => {
  it("formats seconds, minutes and hours", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(200_000)).toBe("3m 20s");
    expect(formatDuration(3_600_000)).toBe("1h");
    expect(formatDuration(7_500_000)).toBe("2h 5m");
  });
  it("never returns an empty string for bad input", () => {
    expect(formatDuration(Number.NaN)).toBe("0s");
    expect(formatDuration(-5)).toBe("0s");
  });
});

describe("formatMinutes and formatHours", () => {
  it("rounds minutes into compact labels", () => {
    expect(formatMinutes(90)).toBe("1h 30m");
    expect(formatMinutes(12.4)).toBe("12m");
    expect(formatMinutes(0)).toBe("0m");
  });
  it("shows fractional hours to one decimal", () => {
    expect(formatHours(0.5)).toBe("30m");
    expect(formatHours(12.34)).toBe("12.3h");
  });
});

describe("formatBytes", () => {
  it("scales units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(15 * 1024 * 1024)).toBe("15 MB");
    expect(formatBytes(3.5 * 1024 ** 3)).toBe("3.5 GB");
  });
});

describe("formatRelative", () => {
  it("buckets by minute, hour, day", () => {
    const now = 1_000_000_000_000;
    expect(formatRelative(now - 10_000, now)).toBe("just now");
    expect(formatRelative(now - 5 * 60_000, now)).toBe("5m ago");
    expect(formatRelative(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(formatRelative(now - 2 * 86_400_000, now)).toBe("2d ago");
  });
});

describe("misc helpers", () => {
  it("formats percent clamped to 0..100", () => {
    expect(formatPercent(0.724)).toBe("72%");
    expect(formatPercent(1.5)).toBe("100%");
    expect(formatPercent(-1)).toBe("0%");
  });
  it("humanizes tokens", () => {
    expect(humanize("not_useful")).toBe("Not useful");
    expect(humanize("wrong-boundaries")).toBe("Wrong boundaries");
    expect(humanize("")).toBe("");
  });
  it("maps risk classes to labels and tones", () => {
    expect(riskLabel("read_only")).toBe("Read only");
    expect(riskTone("destructive")).toBe("high");
    expect(riskTone("unknown")).toBe("neutral");
  });
  it("labels menu bar statuses", () => {
    expect(menuBarStatusLabel("processing_locally")).toBe("Processing locally");
  });
  it("detects active run states", () => {
    expect(isRunActive("awaiting_approval")).toBe(true);
    expect(isRunActive("completed")).toBe(false);
  });
  it("pluralizes", () => {
    expect(pluralize(1, "skill")).toBe("1 skill");
    expect(pluralize(3, "skill")).toBe("3 skills");
  });
  it("groups timestamps by local hour", () => {
    const ts = new Date(2026, 0, 5, 14, 37, 12).getTime();
    expect(new Date(hourKey(ts)).getMinutes()).toBe(0);
    expect(new Date(hourKey(ts)).getHours()).toBe(14);
  });
  it("round-trips datetime-local values", () => {
    const ts = new Date(2026, 3, 9, 8, 5, 30).getTime();
    const local = toDatetimeLocal(ts);
    expect(local).toBe("2026-04-09T08:05:30");
    expect(fromDatetimeLocal(local)).toBe(ts);
    expect(fromDatetimeLocal("nonsense")).toBeNull();
  });
});
