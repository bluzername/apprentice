import { readFileSync } from "node:fs";
import { HelperEventNameSchema, HELPER_PROTOCOL_VERSION, type HelperEvent } from "@apprentice/schemas";
import { z } from "zod";

export const FixtureLineSchema = z.object({
  delayMs: z.number().nonnegative().default(0),
  event: HelperEventNameSchema,
  data: z.record(z.string(), z.unknown()).default({})
});
export type FixtureLine = z.infer<typeof FixtureLineSchema>;

/** Parses a helper fixture JSONL file (blank lines and # comments ignored). */
export function parseFixtureLines(text: string): FixtureLine[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line, index) => {
      const parsed = FixtureLineSchema.safeParse(JSON.parse(line));
      if (!parsed.success) throw new Error(`Fixture line ${index + 1} is invalid: ${parsed.error.message}`);
      return parsed.data;
    });
}

export function readFixtureLines(path: string): FixtureLine[] {
  return parseFixtureLines(readFileSync(path, "utf8"));
}

export function fixtureLineToEvent(line: FixtureLine, seq: number, ts: number): HelperEvent {
  return { type: "event", v: HELPER_PROTOCOL_VERSION, event: line.event, ts, seq, data: line.data };
}
