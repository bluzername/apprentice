import { useEffect, useRef, useState, type JSX } from "react";
import { PRODUCT_NAME } from "@apprentice/schemas";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { errorMessage } from "../lib/hooks";
import { useStore } from "../state/store";
import { invoke } from "../lib/api";
import { StepIntro } from "./onboarding/StepIntro";
import { StepHardware } from "./onboarding/StepHardware";
import { StepPermissions } from "./onboarding/StepPermissions";
import { StepModel } from "./onboarding/StepModel";
import { StepStart } from "./onboarding/StepStart";
import { AllowlistEditor } from "./shared/AllowlistEditor";
import { FeedbackConsent } from "./shared/FeedbackConsent";

const STEP_TITLES = ["Local first", "Hardware", "Privacy scope", "Permissions", "Model", "Feedback", "Start"] as const;
const LAST = STEP_TITLES.length - 1;
const MODEL_STEP = 4;

export function OnboardingPage(): JSX.Element {
  const { state, updateSettings, setLearning, toast, dispatch } = useStore();
  const settings = state.settings;
  const [step, setStep] = useState(() => Math.min(LAST, Math.max(0, settings?.onboardingStep ?? 0)));
  const [busy, setBusy] = useState(false);
  const [modelConfigured, setModelConfigured] = useState((settings?.model.providerType ?? "mock") !== "mock" || (settings?.demoMode ?? false));
  const bodyRef = useRef<HTMLDivElement>(null);
  const previousStep = useRef(step);

  // Each step renders its own h2; move focus there when the step changes so the
  // new content is announced and keyboard users start at the top of it.
  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    const heading = bodyRef.current?.querySelector<HTMLElement>("h2");
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus();
  }, [step]);

  const persistStep = async (next: number): Promise<void> => {
    setStep(next);
    try {
      await updateSettings({ onboardingStep: next });
    } catch (err) {
      toast("warning", `Progress not saved: ${errorMessage(err)}`);
    }
  };

  const finish = async (): Promise<void> => {
    setBusy(true);
    try {
      await setLearning("learning");
      const done = await invoke("settings:completeOnboarding");
      dispatch({ type: "settings", settings: done });
      toast("success", "Learning mode started");
      window.location.hash = "#/overview";
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const saveAllowlist = async (allowlist: { apps: { bundleId: string; name: string }[]; domains: string[] }): Promise<void> => {
    try {
      await updateSettings({ allowlist });
    } catch (err) {
      toast("error", errorMessage(err));
    }
  };

  let body: JSX.Element;
  switch (step) {
    case 0:
      body = <StepIntro />;
      break;
    case 1:
      body = <StepHardware />;
      break;
    case 2:
      body = (
        <div className="stack">
          <h2>Privacy scope</h2>
          <p>Only the apps and browser domains you add here are ever observed. Nothing is selected for you.</p>
          {settings ? <AllowlistEditor value={settings.allowlist} onChange={(v) => void saveAllowlist(v)} /> : null}
        </div>
      );
      break;
    case 3:
      body = <StepPermissions />;
      break;
    case MODEL_STEP:
      body = <StepModel configured={modelConfigured} onConfigured={() => setModelConfigured(true)} />;
      break;
    case 5:
      body = (
        <div className="stack">
          <h2>Feedback consent</h2>
          <FeedbackConsent />
        </div>
      );
      break;
    default:
      body = <StepStart />;
  }

  const continueBlocked = step === MODEL_STEP && !modelConfigured;

  return (
    <div className="onboarding">
      <div className="onboarding-panel">
        <div className="row">
          <Icon name="logo" size={26} />
          <h1 style={{ fontSize: "var(--text-lg)" }}>{PRODUCT_NAME} setup</h1>
          <span className="spacer" />
          <span className="small muted">
            Step {step + 1} of {STEP_TITLES.length}: {STEP_TITLES[step]}
          </span>
        </div>
        <ol className="onboarding-progress" aria-hidden="true">
          {STEP_TITLES.map((title, i) => (
            <li key={title} className={i < step ? "done" : i === step ? "current" : ""} />
          ))}
        </ol>
        <div className="card" ref={bodyRef}>
          {body}
        </div>
        <div className="onboarding-footer">
          <Button variant="ghost" onClick={() => void persistStep(step - 1)} disabled={step === 0 || busy}>
            Back
          </Button>
          <div className="row">
            {continueBlocked ? (
              <span className="field-hint" id="continue-hint">
                Choose a model option first.
              </span>
            ) : null}
            {settings?.onboardingCompleted ? (
              <Button variant="ghost" onClick={() => { window.location.hash = "#/settings"; }}>
                Exit setup
              </Button>
            ) : null}
            {step < LAST ? (
              <Button variant="primary" onClick={() => void persistStep(step + 1)} disabled={busy || continueBlocked} aria-describedby={continueBlocked ? "continue-hint" : undefined}>
                Continue
              </Button>
            ) : (
              <Button variant="primary" size="lg" busy={busy} onClick={() => void finish()}>
                Start Learning mode
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
