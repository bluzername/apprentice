import type { AppSettings } from "@apprentice/schemas";

export type PulseDay = 1 | 3 | 7;
const PULSE_DAYS: readonly PulseDay[] = [1, 3, 7];
const DAY_MS = 24 * 60 * 60 * 1000;

function sameLocalDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

/** The pulse day due now, if any: day N once `now - firstRunTs >= N days`, never shown, at most one prompt per calendar day. */
export function pendingPulseDay(feedback: AppSettings["feedback"], now: number): PulseDay | null {
  if (feedback.firstRunTs === undefined) return null;
  if (feedback.lastPulsePromptTs !== undefined && sameLocalDay(feedback.lastPulsePromptTs, now)) return null;
  const elapsed = now - feedback.firstRunTs;
  return PULSE_DAYS.find((day) => elapsed >= day * DAY_MS && !feedback.pulseShown.includes(day)) ?? null;
}
