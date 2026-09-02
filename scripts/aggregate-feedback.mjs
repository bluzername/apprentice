#!/usr/bin/env node
/**
 * Aggregates .apprentice-feedback.zip bundles from a folder into CSV files and
 * a static HTML report. Runs fully offline; never sends data anywhere.
 *
 * Bundle layout (written by the desktop app):
 *   manifest.json            FeedbackBundleManifest
 *   product-events.jsonl     one ProductEvent per line (sanitized)
 *   feedback.json            Feedback[]
 *   diagnostics.json         app/model diagnostics (numbers and enums only)
 *   run-trace.json           optional, redacted run trace
 *   screenshots/*.png        optional, only when the user selected them
 *
 * Usage: node scripts/aggregate-feedback.mjs <bundles-dir> [out-dir]
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const yauzl = require("yauzl");

const MAX_ENTRIES = 200;
const MAX_ENTRY_BYTES = 25 * 1024 * 1024;

function isSafeEntryName(name) {
  return /^[A-Za-z0-9_./-]{1,200}$/.test(name) && !name.startsWith("/") && !name.split("/").includes("..");
}

function readBundle(path) {
  return new Promise((resolvePromise, reject) => {
    yauzl.open(path, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      const files = new Map();
      let count = 0;
      zip.readEntry();
      zip.on("entry", (entry) => {
        count += 1;
        if (count > MAX_ENTRIES) return reject(new Error(`${path}: too many entries`));
        if (!isSafeEntryName(entry.fileName)) return reject(new Error(`${path}: unsafe entry name ${entry.fileName}`));
        if (entry.uncompressedSize > MAX_ENTRY_BYTES) return reject(new Error(`${path}: entry too large ${entry.fileName}`));
        if (entry.fileName.endsWith("/")) return zip.readEntry();
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr) return reject(streamErr);
          const chunks = [];
          stream.on("data", (c) => chunks.push(c));
          stream.on("end", () => {
            files.set(entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          });
          stream.on("error", reject);
        });
      });
      zip.on("end", () => resolvePromise(files));
      zip.on("error", reject);
    });
  });
}

const FORBIDDEN = ["screenshot", "ocr", "url", "domain", "title", "clipboard", "typedtext", "transcript", "email", "filename", "prompt", "response"];

function assertNoForbiddenKeys(value, path = "") {
  if (Array.isArray(value)) return value.forEach((v, i) => assertNoForbiddenKeys(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN.includes(k.toLowerCase())) throw new Error(`forbidden field ${path}.${k}`);
      assertNoForbiddenKeys(v, `${path}.${k}`);
    }
  }
}

function validateManifest(m) {
  if (m?.bundleVersion !== 1) throw new Error("bundleVersion must be 1");
  if (!/^[a-f0-9]{16,64}$/.test(m.installationId ?? "")) throw new Error("bad installationId");
  if (typeof m.createdAt !== "number") throw new Error("bad createdAt");
  if (typeof m.appVersion !== "string") throw new Error("bad appVersion");
  return m;
}

function csvEscape(v) {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(rows, columns) {
  return [columns.join(","), ...rows.map((r) => columns.map((c) => csvEscape(r[c])).join(","))].join("\n") + "\n";
}
function median(nums) {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function mean(nums) {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}
function pct(n, d) {
  return d ? Math.round((n / d) * 1000) / 10 : 0;
}

async function main() {
  const [, , inDirArg, outDirArg] = process.argv;
  if (!inDirArg) {
    console.error("usage: aggregate-feedback.mjs <bundles-dir> [out-dir]");
    process.exit(2);
  }
  const inDir = resolve(inDirArg);
  const outDir = resolve(outDirArg ?? join(inDir, "aggregate"));
  mkdirSync(outDir, { recursive: true });
  const bundles = readdirSync(inDir).filter((f) => f.endsWith(".zip")).map((f) => join(inDir, f));
  if (bundles.length === 0) {
    console.error(`no .zip bundles in ${inDir}`);
    process.exit(1);
  }

  const seenEvents = new Set();
  const seenFeedback = new Set();
  const events = [];
  const feedback = [];
  const installations = new Map();
  const problems = [];

  for (const bundle of bundles) {
    try {
      const files = await readBundle(bundle);
      const manifest = validateManifest(JSON.parse(files.get("manifest.json")?.toString("utf8") ?? "null"));
      assertNoForbiddenKeys(manifest, "manifest");
      const inst = installations.get(manifest.installationId) ?? { installationId: manifest.installationId, participantCode: manifest.participantCode ?? "", firstTs: Infinity, appVersions: new Set(), bundles: 0 };
      inst.bundles += 1;
      inst.appVersions.add(manifest.appVersion);
      const eventsText = files.get("product-events.jsonl")?.toString("utf8") ?? "";
      for (const line of eventsText.split("\n").filter(Boolean)) {
        const ev = JSON.parse(line);
        assertNoForbiddenKeys(ev, "event");
        if (typeof ev.id !== "string" || typeof ev.name !== "string" || typeof ev.ts !== "number") throw new Error("bad event");
        if (seenEvents.has(ev.id)) continue;
        seenEvents.add(ev.id);
        events.push({ ...ev, installationId: manifest.installationId });
        inst.firstTs = Math.min(inst.firstTs, ev.ts);
      }
      const fb = JSON.parse(files.get("feedback.json")?.toString("utf8") ?? "[]");
      for (const f of fb) {
        assertNoForbiddenKeys(f, "feedback");
        if (seenFeedback.has(f.id)) continue;
        seenFeedback.add(f.id);
        feedback.push({ ...f, installationId: manifest.installationId });
        inst.firstTs = Math.min(inst.firstTs, f.createdAt ?? Infinity);
      }
      installations.set(manifest.installationId, inst);
    } catch (error) {
      problems.push(`${bundle}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ---- summary metrics ----
  const byName = {};
  for (const e of events) byName[e.name] = (byName[e.name] ?? 0) + 1;
  const funnel = ["app_launched", "onboarding_completed", "learning_started", "candidate_generated", "candidate_viewed", "candidate_accepted", "teach_saved", "skill_saved", "run_started", "run_completed", "feedback_submitted", "export_created"].map((name) => ({ step: name, count: byName[name] ?? 0, installations: new Set(events.filter((e) => e.name === name).map((e) => e.installationId)).size }));
  const candidateFb = feedback.filter((f) => f.answers?.kind === "candidate");
  const runFb = feedback.filter((f) => f.answers?.kind === "run");
  const pulseFb = feedback.filter((f) => f.answers?.kind === "pulse");
  const relevanceRate = pct(candidateFb.filter((f) => f.answers.relevant).length, candidateFb.length);
  const delegation = { yes: 0, maybe: 0, no: 0 };
  for (const f of candidateFb) delegation[f.answers.wouldDelegate] = (delegation[f.answers.wouldDelegate] ?? 0) + 1;
  const boundary = {};
  for (const f of candidateFb) boundary[f.answers.boundaryAccuracy] = (boundary[f.answers.boundaryAccuracy] ?? 0) + 1;
  const runOutcome = { yes: 0, partly: 0, no: 0 };
  for (const f of runFb) runOutcome[f.answers.outcomeAchieved] = (runOutcome[f.answers.outcomeAchieved] ?? 0) + 1;
  const trustMean = mean(runFb.map((f) => f.answers.trustRating));
  const timeSavedMedian = median(runFb.map((f) => f.answers.estimatedTimeSavedMinutes));
  const wouldUseAgain = pct(runFb.filter((f) => f.answers.wouldUseAgain).length, runFb.length);
  const failures = {};
  for (const f of runFb) failures[f.answers.failureCategory] = (failures[f.answers.failureCategory] ?? 0) + 1;
  const retention = { day1: 0, day3: 0, day7: 0 };
  for (const inst of installations.values()) {
    if (!Number.isFinite(inst.firstTs)) continue;
    const active = new Set(events.filter((e) => e.installationId === inst.installationId).map((e) => Math.floor((e.ts - inst.firstTs) / 86400000)));
    if (active.has(1) || active.has(0)) retention.day1 += 1;
    if ([...active].some((d) => d >= 3)) retention.day3 += 1;
    if ([...active].some((d) => d >= 7)) retention.day7 += 1;
  }

  const summaryRows = [
    { metric: "bundles", value: bundles.length },
    { metric: "bundles_with_problems", value: problems.length },
    { metric: "installations", value: installations.size },
    { metric: "events", value: events.length },
    { metric: "feedback_items", value: feedback.length },
    { metric: "candidate_feedback", value: candidateFb.length },
    { metric: "candidate_relevance_pct", value: relevanceRate },
    { metric: "delegation_yes", value: delegation.yes },
    { metric: "delegation_maybe", value: delegation.maybe },
    { metric: "delegation_no", value: delegation.no },
    { metric: "run_feedback", value: runFb.length },
    { metric: "run_outcome_yes", value: runOutcome.yes },
    { metric: "run_outcome_partly", value: runOutcome.partly },
    { metric: "run_outcome_no", value: runOutcome.no },
    { metric: "trust_mean", value: Math.round(trustMean * 100) / 100 },
    { metric: "time_saved_median_min", value: timeSavedMedian },
    { metric: "would_use_again_pct", value: wouldUseAgain },
    { metric: "pulse_responses", value: pulseFb.length },
    { metric: "retention_day1", value: retention.day1 },
    { metric: "retention_day3", value: retention.day3 },
    { metric: "retention_day7", value: retention.day7 },
    ...funnel.map((f) => ({ metric: `funnel_${f.step}`, value: f.count })),
    ...Object.entries(failures).map(([k, v]) => ({ metric: `failure_${k}`, value: v })),
    ...Object.entries(boundary).map(([k, v]) => ({ metric: `boundary_${k}`, value: v }))
  ];
  writeFileSync(join(outDir, "feedback-summary.csv"), toCsv(summaryRows, ["metric", "value"]));
  writeFileSync(join(outDir, "feedback-comments.csv"), toCsv(
    feedback.filter((f) => typeof f.comment === "string" && f.comment.length > 0).map((f) => ({ installationId: f.installationId.slice(0, 8), contextType: f.contextType, createdAt: new Date(f.createdAt).toISOString(), comment: f.comment })),
    ["installationId", "contextType", "createdAt", "comment"]
  ));

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const table = (rows, cols) => `<table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td>${esc(r[c] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Apprentice alpha feedback report</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem;color:#1d1d1f;line-height:1.5}table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{border:1px solid #d2d2d7;padding:.4rem .6rem;text-align:left;font-size:14px}th{background:#f5f5f7}h2{margin-top:2rem}.muted{color:#515154}</style></head><body>
<h1>Apprentice alpha feedback report</h1>
<p class="muted">Generated ${esc(new Date().toISOString())} from ${bundles.length} bundle(s), ${installations.size} installation(s). Offline aggregation; no data was sent anywhere.</p>
<h2>Funnel</h2>${table(funnel, ["step", "count", "installations"])}
<h2>Candidate relevance and delegation intent</h2>${table([{ metric: "relevance %", value: relevanceRate }, { metric: "delegate yes", value: delegation.yes }, { metric: "delegate maybe", value: delegation.maybe }, { metric: "delegate no", value: delegation.no }, ...Object.entries(boundary).map(([k, v]) => ({ metric: `boundary ${k}`, value: v }))], ["metric", "value"])}
<h2>Run success, trust, time saved</h2>${table([{ metric: "outcome yes", value: runOutcome.yes }, { metric: "outcome partly", value: runOutcome.partly }, { metric: "outcome no", value: runOutcome.no }, { metric: "trust mean (1-5)", value: Math.round(trustMean * 100) / 100 }, { metric: "median time saved (min)", value: timeSavedMedian }, { metric: "would use again %", value: wouldUseAgain }], ["metric", "value"])}
<h2>Failure categories</h2>${table(Object.entries(failures).map(([k, v]) => ({ category: k, count: v })), ["category", "count"])}
<h2>Retention by test day</h2>${table([{ day: "day 1", installations: retention.day1 }, { day: "day 3", installations: retention.day3 }, { day: "day 7", installations: retention.day7 }], ["day", "installations"])}
<h2>Comments</h2>${table(feedback.filter((f) => f.comment).map((f) => ({ context: f.contextType, when: new Date(f.createdAt).toISOString(), comment: f.comment })), ["context", "when", "comment"])}
${problems.length ? `<h2>Bundles with problems</h2><ul>${problems.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
</body></html>`;
  writeFileSync(join(outDir, "feedback-report.html"), html);
  console.log(JSON.stringify({ outDir, bundles: bundles.length, installations: installations.size, events: events.length, feedback: feedback.length, problems }));
  if (!existsSync(join(outDir, "feedback-report.html"))) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
