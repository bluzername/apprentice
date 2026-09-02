import { isHttpUrl, PRODUCT_NAME, type AppSettings } from "@apprentice/schemas";
import { APP_VERSION } from "../services/app-version.js";
import type { Services } from "../services/composition.js";
import type { IpcHandlers } from "./registry.js";

/** Every channel of the contract, delegating to services. Validation happens in the registry. */
export function createIpcHandlers(services: Services): IpcHandlers {
  const { context, learning, permissions, activity, scheduler, teach, candidates, skills, runEngine, feedback, privacy, model, demo, loopback, shell } = services;
  const { settings, storage, analytics, metrics } = context;
  let helperVersion: string | undefined;

  return {
    "app:version": async () => {
      if (helperVersion === undefined && services.helper.connected) {
        helperVersion = await services.helper.capabilities().then((caps) => caps.helperVersion).catch(() => undefined);
      }
      return { version: APP_VERSION, productName: PRODUCT_NAME, helperVersion };
    },
    "app:overview": () => services.overview(),
    "app:hardware": () => services.hardware.info(),
    "app:openDataFolder": async () => {
      await shell.openPath(context.paths.root);
      return { ok: true };
    },
    "app:openExternal": async ({ url }) => {
      // The contract schema already restricts this; keep the check next to the OS call.
      if (!isHttpUrl(url)) throw new Error("Only http(s) URLs can be opened");
      await shell.openExternal(url);
      return { ok: true };
    },
    "app:revealPath": ({ path }) => {
      shell.showItemInFolder(path);
      return { ok: true };
    },

    "settings:get": () => settings.get(),
    "settings:update": async (patch) => {
      const { learning: learningPatch, ...rest } = patch;
      if (Object.keys(rest).length > 0) settings.update(rest as Partial<AppSettings>);
      if (learningPatch?.state !== undefined && learningPatch.state !== learning.state()) await learning.setState(learningPatch.state);
      return settings.get();
    },
    "settings:completeOnboarding": () => {
      const updated = settings.update({ onboardingCompleted: true, onboardingStep: 7 });
      analytics.track("onboarding_completed", { demoMode: updated.demoMode, provider: updated.model.providerType });
      return updated;
    },

    "permissions:status": () => permissions.status(),
    "permissions:request": ({ kind }) => permissions.request(kind),
    "permissions:openSettings": async ({ kind }) => {
      await permissions.openSettings(kind);
      return { ok: true };
    },

    "learning:setState": ({ state, pauseMinutes }) => learning.setState(state, pauseMinutes),
    "learning:status": () => learning.snapshot(),

    "activity:list": (query) => activity.list(query),
    "activity:deleteEvents": ({ eventIds }) => ({ deleted: activity.deleteEvents(eventIds) }),
    "activity:deleteRange": ({ fromTs, toTs }) => ({ deleted: activity.deleteRange(fromTs, toTs) }),
    "screenshot:get": ({ id }) => activity.screenshot(id),

    "episodes:list": ({ limit }) => storage.current.episodes.list(limit),
    "episodes:resegment": () => {
      const result = scheduler.runNow();
      return { episodes: result.episodes, candidates: result.candidates };
    },

    "teach:openRange": ({ minutes }) => teach.openRange(minutes),
    "teach:draft": (range) => teach.draft(range),
    "teach:save": ({ draft, range, mode }) => teach.save(draft, range, mode),

    "candidates:list": ({ includeSuppressed }) => storage.current.candidates.list(includeSuppressed),
    "candidates:get": ({ id }) => {
      const candidate = candidates.get(id);
      analytics.track("candidate_viewed", { repeatCount: candidate.repeatCount }, candidate.riskClass);
      const episodes = storage.current.episodes.byIds(candidate.evidenceEpisodeIds);
      return { candidate, evidence: episodes.map((episode) => ({ episode, events: storage.current.events.byIds(episode.eventIds) })) };
    },
    "candidates:act": ({ id, action }) => candidates.act(id, action),
    "candidates:draft": ({ id }) => candidates.draft(id),

    "skills:list": () => skills.list(),
    "skills:get": ({ id }) => skills.get(id),
    "skills:save": ({ skill, correctionNote }) => skills.save(skill, correctionNote),
    "skills:delete": ({ id }) => ({ deleted: skills.delete(id) }),

    "runs:start": ({ skillId, mode, variables }) => runEngine.start(skillId, mode, variables),
    "runs:list": ({ limit }) => runEngine.list(limit),
    "runs:get": ({ id }) => runEngine.get(id),
    "runs:approve": ({ runId, stepId, decision, scope }) => runEngine.approve(runId, stepId, decision, scope),
    "runs:answer": ({ runId, stepId, answer, confirmSubtask }) => runEngine.answer(runId, stepId, answer, confirmSubtask),
    "runs:stop": ({ runId }) => runEngine.stop(runId, "ui_stop"),
    "runs:exportDiagnostics": ({ runId }) => feedback.exportDiagnostics(runId),
    "runs:previewDiagnostics": ({ runId }) => feedback.previewDiagnostics(runId),

    "feedback:submit": ({ contextType, contextId, answers, comment }) => feedback.submit({ contextType, contextId, answers, comment, commentWarningShown: comment !== undefined }),
    "feedback:list": () => feedback.list(),
    "feedback:previewPayload": () => feedback.previewPayload(),
    "feedback:upload": () => feedback.upload(),
    "feedback:export": ({ includeRunId, screenshotIds }) => feedback.exportBundle({ includeRunId, screenshotIds }),
    "feedback:dismissPulse": ({ day }) => {
      feedback.dismissPulse(day);
      return { ok: true };
    },

    "privacy:stats": () => privacy.stats(),
    "privacy:deleteToday": () => privacy.deleteToday(),
    "privacy:deleteSkillData": ({ skillId }) => ({ ok: privacy.deleteSkillData(skillId) }),
    "privacy:deleteAll": ({ confirmPhrase, includeSharedModelFiles }) => privacy.deleteAll(confirmPhrase, includeSharedModelFiles),
    "privacy:retentionRun": () => privacy.retentionRun(),

    "model:status": () => model.status(),
    "model:testConnection": (config) => model.testConnection(config),
    "model:configure": ({ providerType, endpoint, managedRuntime }) => model.configure({ providerType, endpoint, managedRuntime }),
    "model:runtime": ({ action, confirmed }) => model.runtimeAction(action, confirmed),
    "model:runtimeInfo": async () => {
      const { runtimeInfoFrom, MODEL_MANIFEST } = await import("../services/model/manifest.js");
      return runtimeInfoFrom(MODEL_MANIFEST);
    },
    "model:stopAll": () => model.stopAll(),

    "demo:load": ({ days, scenarios }) => demo.load(days, scenarios),
    "demo:reset": () => demo.reset(),
    "demo:status": () => demo.status(),

    "extension:status": () => loopback.status(),
    "extension:pairingCode": () => loopback.issuePairingCode(),
    "extension:unpair": () => loopback.unpair(),

    "analytics:track": ({ name, props }) => {
      analytics.track(name, props);
      return { ok: true };
    },
    "analytics:list": ({ limit }) => storage.current.productEvents.list(limit),
    "perf:metrics": () => ({ ...metrics.flat(), "helper.restarts": services.helper.restarts })
  };
}
