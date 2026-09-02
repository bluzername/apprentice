/**
 * Playwright journey through the Apprentice demo mode. Mirrors the headless
 * smoke test (src/main/headless/smoke.ts) but drives the real renderer:
 * onboarding -> candidates -> skill -> guided run with approvals -> feedback
 * export and aggregation -> privacy deletion.
 *
 * The app is launched with `--e2e`, so the fixture screen source, the fake
 * helper and a granted permission system are used. No macOS permissions are
 * required and nothing outside APPRENTICE_DATA_DIR is written.
 */
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const APP_DIR = resolve(__dirname, "..");
const REPO_ROOT = resolve(APP_DIR, "../..");
const BUILD_OUTPUTS = ["out/main/index.js", "out/preload/index.js", "out/renderer/index.html"] as const;
const BUNDLE_SUFFIX = ".apprentice-feedback.zip";
const MAX_RUN_ITERATIONS = 40;
const RUN_STEP_TIMEOUT_MS = 90_000;
const LONG_TIMEOUT_MS = 60_000;

test.describe.configure({ mode: "serial" });
test.setTimeout(15 * 60_000);

let app: ElectronApplication;
let page: Page;
let dataDir: string;

function ensureBuilt(): void {
  if (BUILD_OUTPUTS.every((rel) => existsSync(join(APP_DIR, rel)))) return;
  execFileSync("pnpm", ["--filter", "@apprentice/desktop", "exec", "electron-vite", "build"], { cwd: REPO_ROOT, stdio: "inherit" });
  const missing = BUILD_OUTPUTS.filter((rel) => !existsSync(join(APP_DIR, rel)));
  if (missing.length > 0) throw new Error(`electron-vite build did not produce: ${missing.join(", ")}`);
}

async function shot(name: string): Promise<void> {
  await page.screenshot({ path: test.info().outputPath(`${name}.png`) });
}

function toast(pattern: RegExp): Locator {
  return page.locator(".toast", { hasText: pattern });
}

function navLink(label: string): Locator {
  return page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: label, exact: true });
}

function continueButton(): Locator {
  return page.getByRole("button", { name: "Continue", exact: true });
}

/** Recursively collects every object key of a JSON value. */
function collectKeys(value: unknown, into: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, into);
  } else if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      into.push(key);
      collectKeys(nested, into);
    }
  }
  return into;
}

function statValue(label: string): Locator {
  return page.locator(".card", { has: page.locator(".stat-label", { hasText: new RegExp(`^${label}$`) }) }).locator(".stat");
}

type RunState = { kind: "approval"; title: string } | { kind: "question" } | { kind: "finished"; status: string } | { kind: "pending" };

async function readRunState(): Promise<RunState> {
  const finished = page.locator(".callout", { hasText: "Finished:" });
  if ((await finished.count()) > 0) return { kind: "finished", status: (await finished.first().innerText()).trim() };
  const approvalTitle = page.locator("#approval-title");
  if ((await approvalTitle.count()) > 0) return { kind: "approval", title: (await approvalTitle.first().innerText()).trim() };
  if ((await page.getByRole("heading", { name: "The run has a question" }).count()) > 0) return { kind: "question" };
  return { kind: "pending" };
}

function stateKey(state: RunState): string {
  return state.kind === "approval" ? `approval:${state.title}` : state.kind;
}

/** Waits until the run shows something other than `previous` (and not a transient pending state). */
async function waitForRunState(previous: string | null): Promise<RunState> {
  let latest: RunState = { kind: "pending" };
  await expect
    .poll(
      async () => {
        latest = await readRunState();
        if (latest.kind === "pending") return null;
        return stateKey(latest) === previous ? null : stateKey(latest);
      },
      { timeout: RUN_STEP_TIMEOUT_MS, message: "run did not advance to a new state" }
    )
    .not.toBeNull();
  return latest;
}

async function approveCurrentStep(): Promise<void> {
  const panel = page.locator("section.approval-panel");
  await expect(panel).toBeVisible();
  await expect(panel.locator(".approval-shot img")).toBeVisible();
  await expect(panel.locator(".approval-shot img")).toHaveAttribute("src", /^data:image\/png;base64,/);
  await expect(panel.locator('[title^="Risk class:"]').first()).toBeVisible();
  await panel.getByRole("button", { name: "Approve once" }).click();
}

async function answerQuestion(): Promise<void> {
  await page.getByLabel("Your answer").fill("confirmed by e2e");
  await page.getByRole("checkbox", { name: /This also confirms the current subtask is complete/ }).check();
  await page.getByRole("button", { name: "Send answer" }).click();
}

test.beforeAll(async () => {
  ensureBuilt();
  dataDir = mkdtempSync(join(tmpdir(), "apprentice-e2e-"));
  const env = Object.fromEntries(
    Object.entries({ ...process.env, APPRENTICE_DATA_DIR: dataDir, APPRENTICE_E2E: "1" }).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string" && entry[0] !== "ELECTRON_RENDERER_URL" && entry[0] !== "ELECTRON_RUN_AS_NODE"
    )
  );
  app = await electron.launch({ args: [join(APP_DIR, "out/main/index.js"), "--e2e"], env, cwd: APP_DIR, timeout: LONG_TIMEOUT_MS });
  page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
});

test.afterAll(async () => {
  if (app) await app.close().catch(() => undefined);
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

test("demo journey: onboarding, candidate, skill, guided run, feedback, privacy", async () => {
  let approvals = 0;
  let questions = 0;

  await test.step("onboarding: intro and hardware", async () => {
    await expect(page.getByRole("heading", { name: "Local first" })).toBeVisible({ timeout: LONG_TIMEOUT_MS });
    await expect(page.getByText("Step 1 of 7")).toBeVisible();
    await shot("01-onboarding-intro");
    await continueButton().click();

    await expect(page.getByRole("heading", { name: "Hardware check" })).toBeVisible();
    const chip = page.locator("dt", { hasText: /^Chip$/ }).locator("xpath=following-sibling::dd[1]");
    await expect(chip).toHaveText(/\S/);
    await shot("02-onboarding-hardware");
    await continueButton().click();
  });

  await test.step("onboarding: privacy scope starts empty, then add an app and a domain", async () => {
    await expect(page.getByRole("heading", { name: "Privacy scope" })).toBeVisible();
    await expect(page.getByText("No applications allowed yet")).toBeVisible();
    await expect(page.getByText("Nothing added yet.")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(0);

    await page.getByRole("button", { name: "Add Safari" }).click();
    await expect(page.getByRole("button", { name: "Remove Safari" })).toBeVisible();

    await page.getByLabel("New Allowed browser domains").fill("crm.example");
    await page.getByRole("button", { name: "Add domain" }).click();
    await expect(page.getByRole("button", { name: "Remove crm.example" })).toBeVisible();
    await shot("03-onboarding-privacy-scope");
    await continueButton().click();
  });

  await test.step("onboarding: permissions come from the fake helper", async () => {
    await expect(page.getByRole("heading", { name: "Permissions" })).toBeVisible();
    await expect(page.getByText("Granted", { exact: true })).toHaveCount(2);
    await shot("04-onboarding-permissions");
    await continueButton().click();
  });

  await test.step("onboarding: choose demo mode", async () => {
    await expect(page.getByRole("heading", { name: "Model setup" })).toBeVisible();
    await expect(continueButton()).toBeDisabled();
    await page.getByRole("radio", { name: /Demo mode, no model/ }).check();
    await page.getByRole("button", { name: "Use demo mode" }).click();
    await expect(page.getByText("Model configured.")).toBeVisible({ timeout: LONG_TIMEOUT_MS });
    await expect(toast(/Demo mode ready with \d+ simulated days/)).toBeVisible();
    await shot("05-onboarding-model");
    await continueButton().click();
  });

  await test.step("onboarding: feedback consent stays off, payload preview has no screenshot or url keys", async () => {
    await expect(page.getByRole("heading", { name: "Feedback consent" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /Send structured feedback to the alpha programme/ })).not.toBeChecked();

    await page.getByRole("button", { name: "Preview outgoing payload" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Outgoing feedback payload" })).toBeVisible();
    const json = dialog.getByLabel("Outgoing payload JSON");
    await expect(json).toBeVisible();
    const parsed: unknown = JSON.parse((await json.textContent()) ?? "");
    expect(parsed).toBeTruthy();
    expect(typeof parsed).toBe("object");
    const forbidden = collectKeys(parsed).filter((key) => /screenshot|url/i.test(key));
    expect(forbidden).toEqual([]);
    await shot("06-onboarding-payload-preview");
    await dialog.getByRole("button", { name: "Close" }).first().click();
    await expect(dialog).toHaveCount(0);
    await continueButton().click();
  });

  await test.step("onboarding: start learning and land on the overview", async () => {
    await expect(page.getByRole("heading", { name: "Start Learning mode" })).toBeVisible();
    await expect(page.getByText("Demo mode is on")).toBeVisible();
    await page.getByRole("button", { name: "Start Learning mode" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible({ timeout: LONG_TIMEOUT_MS });
    await expect(page.locator(".status-chip")).toHaveText(/Learning|Processing locally/);
    await shot("07-overview");
  });

  await test.step("candidates: observed at least twice, evidence detail", async () => {
    await navLink("Candidates").click();
    await expect(page.getByRole("heading", { level: 1, name: "Candidates" })).toBeVisible();
    const firstCard = page.getByRole("article").first();
    await expect(firstCard).toBeVisible({ timeout: LONG_TIMEOUT_MS });
    const observed = firstCard.getByText(/Observed \d+ times/);
    await expect(observed).toBeVisible();
    const count = Number(/Observed (\d+) times/.exec(await observed.innerText())?.[1]);
    expect(count).toBeGreaterThanOrEqual(2);
    await shot("08-candidates");

    await firstCard.getByRole("link", { name: "Evidence" }).click();
    await expect(page.getByRole("link", { name: "Back to candidates" })).toBeVisible();
    const detail = page.getByRole("article");
    await expect(detail.getByRole("meter", { name: "Confidence" })).toBeVisible();
    await expect(detail.locator("dd", { has: page.getByRole("meter", { name: "Confidence" }) }).locator(".small.muted")).toHaveText(/\S/);
    await expect(detail.getByRole("heading", { name: "Steps" })).toBeVisible();
    expect(await detail.locator("ol.steps-list li").count()).toBeGreaterThan(0);
    await expect(detail.locator('[title^="Risk class:"]').first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Evidence timeline" })).toBeVisible();
    await expect(page.getByText(/Occurrence 1:/)).toBeVisible();
    await shot("09-candidate-detail");
  });

  await test.step("skill: edit and save the candidate as 'E2E Skill'", async () => {
    await page.getByRole("button", { name: "Edit and save" }).click();
    await expect(toast(/Skill created/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to skills" })).toBeVisible();
    await expect(page.getByText("v1", { exact: true })).toBeVisible();
    await expect(page.getByText("Version 1", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Version 2", { exact: true })).toHaveCount(0);

    const identity = page.locator(".card", { has: page.getByRole("heading", { name: "Identity" }) });
    await identity.getByLabel("Name", { exact: true }).fill("E2E Skill");
    await page.getByRole("button", { name: "Save as version 2" }).click();
    await expect(toast(/Skill saved as a new version/)).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "E2E Skill" })).toBeVisible();
    await shot("10-skill-saved");

    await navLink("Skills").click();
    const row = page.getByRole("row").filter({ hasText: "E2E Skill" });
    await expect(row).toBeVisible();
    await expect(row).toContainText("v2");
    await row.click();
    await expect(page.getByRole("heading", { level: 2, name: "E2E Skill" })).toBeVisible();
    await expect(page.getByText("v2", { exact: true })).toBeVisible();
    await expect(page.getByText("Version 1", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Version 2", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Changed: name").first()).toBeVisible();
    await shot("11-skill-detail");
  });

  await test.step("guided run: approve every step until completed", async () => {
    await page.getByRole("button", { name: "Run in guide mode" }).click();
    await expect(page.getByRole("link", { name: "Back to runs" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "E2E Skill" })).toBeVisible();

    let previous: string | null = null;
    let finished = false;
    for (let i = 0; i < MAX_RUN_ITERATIONS && !finished; i += 1) {
      const state = await waitForRunState(previous);
      previous = stateKey(state);
      if (state.kind === "approval") {
        approvals += 1;
        if (approvals === 1) await shot("12-run-approval");
        await approveCurrentStep();
      } else if (state.kind === "question") {
        questions += 1;
        await shot(`12-run-question-${questions}`);
        await answerQuestion();
      } else if (state.kind === "finished") {
        finished = true;
      }
    }
    expect(finished, `run did not finish within ${MAX_RUN_ITERATIONS} iterations`).toBe(true);
    expect(approvals).toBeGreaterThan(0);
    test.info().annotations.push({ type: "approvals", description: String(approvals) });
    test.info().annotations.push({ type: "questions", description: String(questions) });

    await expect(page.locator(".callout", { hasText: "Finished:" })).toContainText("Completed");
    await expect(page.locator(".page-header .badge", { hasText: "Completed" })).toBeVisible();
    const trace = page.getByRole("list", { name: "Step-by-step trace" });
    const steps = trace.getByRole("listitem");
    expect(await steps.count()).toBeGreaterThan(0);
    await expect(steps.first()).toContainText("Verification");
    await expect(trace.getByText(/Passed via/).first()).toBeVisible();
    await shot("13-run-completed");
  });

  await test.step("feedback: submit the structured run feedback", async () => {
    const form = page.locator(".card", { hasText: "How did this run go?" });
    await expect(form).toBeVisible();
    await form.getByRole("group", { name: "Outcome achieved" }).getByRole("radio", { name: "Yes", exact: true }).check();
    await form.getByLabel("Corrections you made").fill("0");
    await form.getByLabel("Estimated time saved (minutes)").fill("5");
    await form.getByRole("radiogroup", { name: "Trust rating" }).getByRole("radio", { name: "4", exact: true }).check();
    await form.getByRole("checkbox", { name: "I would use this again" }).check();
    await shot("14-run-feedback-form");
    await form.getByRole("button", { name: "Send structured feedback" }).click();
    await expect(toast(/Run feedback stored locally/)).toBeVisible();
    await expect(form).toHaveCount(0);
  });

  await test.step("feedback: export a bundle without screenshots and aggregate it", async () => {
    await navLink("Feedback").click();
    await expect(page.getByRole("heading", { level: 1, name: "Feedback" })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "outcome yes, trust 4/5" })).toBeVisible();
    await page.getByRole("button", { name: "Export feedback bundle" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Export feedback bundle" })).toBeVisible();
    await expect(dialog.getByRole("checkbox")).toHaveCount(0);
    await shot("15-export-dialog");
    await dialog.getByRole("button", { name: "Export without screenshots", exact: true }).click();
    await expect(toast(/Bundle written: \d+ files, .* no screenshots/)).toBeVisible();
    await expect(dialog).toHaveCount(0);

    const exportsDir = join(dataDir, "exports");
    let bundles: string[] = [];
    await expect
      .poll(() => {
        bundles = existsSync(exportsDir) ? readdirSync(exportsDir).filter((name) => name.endsWith(BUNDLE_SUFFIX)) : [];
        return bundles.length;
      })
      .toBeGreaterThan(0);
    const bundlePath = join(exportsDir, bundles[0] ?? "");
    expect(bundlePath.endsWith(BUNDLE_SUFFIX)).toBe(true);
    expect(existsSync(bundlePath)).toBe(true);
    test.info().annotations.push({ type: "bundle", description: bundlePath });

    const outDir = test.info().outputPath("aggregate");
    execFileSync("node", [join(REPO_ROOT, "scripts/aggregate-feedback.mjs"), exportsDir, outDir], { cwd: REPO_ROOT, stdio: "inherit" });
    expect(existsSync(join(outDir, "feedback-summary.csv"))).toBe(true);
    await shot("16-feedback-page");
  });

  await test.step("privacy: delete today and see the stats change", async () => {
    await navLink("Privacy").click();
    await expect(page.getByRole("heading", { level: 1, name: "Privacy" })).toBeVisible();
    await expect(statValue("Screenshots")).toHaveText(/^\d+$/);
    await expect(statValue("Events")).toHaveText(/^\d+$/);
    const screenshotsBefore = Number(await statValue("Screenshots").innerText());
    const eventsBefore = Number(await statValue("Events").innerText());
    await shot("17-privacy-before");

    await page.getByRole("button", { name: "Delete today", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Delete today's data?" })).toBeVisible();
    await dialog.getByRole("button", { name: "Delete today", exact: true }).click();
    await expect(toast(/Deleted \d+ events and \d+ screenshots/)).toBeVisible();
    await expect(dialog).toHaveCount(0);

    await expect
      .poll(async () => {
        const screenshots = Number(await statValue("Screenshots").innerText());
        const events = Number(await statValue("Events").innerText());
        return screenshots < screenshotsBefore || events !== eventsBefore;
      })
      .toBe(true);
    await shot("18-privacy-after");
  });
});
