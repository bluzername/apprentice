import type { ModelStatus, Overview, PermissionsStatus } from "@apprentice/schemas";
import type { StorageRef } from "./app-context.js";
import type { LearningSnapshot } from "./learning/learning-state.js";

export interface OverviewDeps {
  readonly storage: StorageRef;
  readonly learning: () => LearningSnapshot;
  readonly modelStatus: () => Promise<ModelStatus>;
  readonly permissions: () => Promise<PermissionsStatus>;
  readonly demoMode: () => boolean;
  readonly helperConnected: () => boolean;
  readonly extensionPaired: () => boolean;
  readonly pendingPulseDay: () => 1 | 3 | 7 | null;
}

/** Dashboard summary for "app:overview". */
export async function buildOverview(deps: OverviewDeps): Promise<Overview> {
  const storage = deps.storage.current;
  const learning = deps.learning();
  const candidates = storage.candidates.list(false);
  const [modelStatus, permissions] = await Promise.all([deps.modelStatus(), deps.permissions()]);
  return {
    learningState: learning.state,
    menuBarStatus: learning.menuBarStatus,
    modelStatus,
    hoursObserved: Math.round(storage.events.observedHours() * 100) / 100,
    candidateCount: candidates.length,
    skillCount: storage.skills.countCurrent(),
    estimatedWeeklyMinutes: Math.round(candidates.reduce((sum, candidate) => sum + candidate.estimatedWeeklyMinutes, 0) * 10) / 10,
    recentCandidate: candidates[0] ?? null,
    recentRun: storage.runs.list(1)[0] ?? null,
    permissions,
    demoMode: deps.demoMode(),
    helperConnected: deps.helperConnected(),
    extensionPaired: deps.extensionPaired(),
    pendingPulseDay: deps.pendingPulseDay()
  };
}
