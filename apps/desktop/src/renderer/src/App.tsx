import { useEffect, type JSX } from "react";
import { StoreProvider, useStore } from "./state/store";
import { AppShell } from "./shell/AppShell";
import { ToastRegion } from "./components/Toast";
import { ErrorState, InlineLoading } from "./components/States";
import { OverviewPage } from "./pages/Overview";
import { ActivityPage } from "./pages/Activity";
import { CandidatesPage } from "./pages/Candidates";
import { SkillsPage } from "./pages/Skills";
import { RunsPage } from "./pages/Runs";
import { FeedbackPage } from "./pages/Feedback";
import { PrivacyPage } from "./pages/Privacy";
import { SettingsPage } from "./pages/Settings";
import { TeachPage } from "./pages/Teach";
import { OnboardingPage } from "./pages/Onboarding";

function Router(): JSX.Element {
  const { state, dispatch, reloadSettings } = useStore();
  const { route, settings } = state;

  useEffect(() => {
    if (settings && !settings.onboardingCompleted && route.page !== "onboarding") {
      window.location.hash = "#/onboarding";
    }
  }, [settings, route.page]);

  if (state.bridgeMissing) {
    return (
      <div style={{ padding: 40 }}>
        <ErrorState title="Desktop bridge unavailable" message="This page must run inside the Apprentice app. The preload bridge was not found." />
      </div>
    );
  }
  if (state.settingsError) {
    return (
      <div style={{ padding: 40 }}>
        <ErrorState title="Could not load settings" message={state.settingsError} onRetry={() => void reloadSettings()} />
      </div>
    );
  }
  if (!settings) {
    return (
      <div style={{ padding: 40 }}>
        <InlineLoading label="Starting" />
      </div>
    );
  }
  if (route.page === "onboarding" || !settings.onboardingCompleted) {
    return (
      <>
        <OnboardingPage />
        <ToastRegion toasts={state.toasts} onDismiss={(id) => dispatch({ type: "dismissToast", id })} />
      </>
    );
  }

  let page: JSX.Element;
  switch (route.page) {
    case "activity":
      page = <ActivityPage />;
      break;
    case "candidates":
      page = <CandidatesPage id={route.id} />;
      break;
    case "skills":
      page = <SkillsPage id={route.id} />;
      break;
    case "runs":
      page = <RunsPage id={route.id} />;
      break;
    case "feedback":
      page = <FeedbackPage />;
      break;
    case "privacy":
      page = <PrivacyPage />;
      break;
    case "settings":
      page = <SettingsPage />;
      break;
    case "teach":
      page = <TeachPage />;
      break;
    default:
      page = <OverviewPage />;
  }
  return (
    <>
      <AppShell>{page}</AppShell>
      <ToastRegion toasts={state.toasts} onDismiss={(id) => dispatch({ type: "dismissToast", id })} />
    </>
  );
}

export function App(): JSX.Element {
  return (
    <StoreProvider>
      <Router />
    </StoreProvider>
  );
}
