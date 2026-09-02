export type LaunchMode = "normal" | "smoke" | "e2e";

/** `--smoke-test` / APPRENTICE_SMOKE_TEST=1 run headless; `--e2e` / APPRENTICE_E2E=1 keep windows but use fixtures. */
export function detectLaunchMode(argv: readonly string[], env: NodeJS.ProcessEnv): LaunchMode {
  if (argv.includes("--smoke-test") || env.APPRENTICE_SMOKE_TEST === "1") return "smoke";
  if (argv.includes("--e2e") || env.APPRENTICE_E2E === "1") return "e2e";
  return "normal";
}
