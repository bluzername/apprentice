#!/usr/bin/env node
/**
 * One-shot developer bootstrap: checks tools, installs dependencies, builds
 * the helper, renders fixtures. Never uses sudo and never installs system tools.
 */
import { execFileSync } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;
function run(cmd, args) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { stdio: "inherit", cwd: ROOT });
}
function check(cmd, args, hint) {
  try {
    const out = execFileSync(cmd, args, { encoding: "utf8" }).trim().split("\n")[0];
    console.log(`ok   ${cmd}: ${out}`);
    return true;
  } catch {
    console.error(`miss ${cmd}: ${hint}`);
    return false;
  }
}
const ok = [
  check("node", ["--version"], "install Node 22.12+"),
  check("pnpm", ["--version"], "corepack enable && corepack prepare pnpm@10 --activate"),
  check("swift", ["--version"], "install Xcode Command Line Tools"),
  check("uname", ["-m"], "")
].every(Boolean);
if (!ok) process.exit(1);
if (process.arch !== "arm64") console.warn("warning: this project targets Apple Silicon (arm64)");
run("pnpm", ["install"]);
run("node", ["scripts/build-helper.mjs"]);
run("pnpm", ["--filter", "@apprentice/test-fixtures", "run", "build"]);
console.log("Bootstrap complete. Next: pnpm typecheck && pnpm test && pnpm build");
