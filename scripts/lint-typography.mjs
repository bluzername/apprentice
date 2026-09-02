#!/usr/bin/env node
/**
 * Fails when an em dash (U+2014) or smart quotes appear in source or docs.
 * Vendored third-party files are excluded.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SKIP_DIRS = new Set(["node_modules", "dist", "out", "build", ".build", ".git", "release", "third_party", "coverage", ".wrangler", "test-results", "playwright-report"]);
const SKIP_FILES = new Set(["self_learning_work_agent_claude_code_master_prompt.md", "pnpm-lock.yaml"]);
const EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".js", ".mjs", ".cjs", ".md", ".json", ".yml", ".yaml", ".toml", ".html", ".css", ".swift", ".sh", ".sql", ".svg"]);
const BAD = /[—–‘’“”]/;

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (EXTENSIONS.has(entry.slice(entry.lastIndexOf("."))) && !SKIP_FILES.has(entry)) out.push(full);
  }
  return out;
}

const offenders = [];
for (const file of walk(ROOT, [])) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    if (BAD.test(line)) offenders.push(`${relative(ROOT, file)}:${i + 1}`);
  });
}
if (offenders.length > 0) {
  console.error(`Typography lint failed: em dashes or smart quotes found in ${offenders.length} line(s):`);
  for (const o of offenders.slice(0, 50)) console.error(`  ${o}`);
  process.exit(1);
}
console.log("Typography lint passed.");
