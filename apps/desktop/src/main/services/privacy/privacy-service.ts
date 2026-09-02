import { DEFAULT_DENY_APP_BUNDLE_PATTERNS, DEFAULT_DENY_DOMAIN_PATTERNS, type PrivacyStats } from "@apprentice/schemas";
import type { Analytics } from "../analytics.js";
import type { AppContext } from "../app-context.js";
import type { Clock } from "../clock.js";
import { ServiceError } from "../errors.js";
import type { Logger } from "../logger.js";
import { DELETE_ALL_PHRASE, deleteAllFiles } from "./delete-all.js";
import { runDeleteToday, runRetention, type RetentionOutcome } from "./retention.js";

export interface PrivacyServiceDeps {
  readonly context: AppContext;
  readonly analytics: Analytics;
  readonly clock: Clock;
  readonly logger: Logger;
  /** Stops observation, runs, and model work before the database is closed. */
  readonly quiesce: () => Promise<void>;
  /** Re-arms services after storage was re-created. */
  readonly afterReset: () => Promise<void>;
  readonly securePauseCount: () => number;
  readonly retentionExcludedSessions: () => ReadonlySet<string>;
  readonly retentionIntervalMs?: number;
}

/** Privacy dashboard: stats, delete today / skill / all, and the hourly retention pass. */
export class PrivacyService {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: PrivacyServiceDeps) {}

  start(): void {
    this.safeRetention();
    this.timer = setInterval(() => this.safeRetention(), this.deps.retentionIntervalMs ?? 60 * 60 * 1000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  stats(): PrivacyStats {
    const storage = this.deps.context.storage.current;
    const blobs = storage.blobs.totalBytes();
    const databaseBytes = storage.db.sizeBytes();
    const exclusions = [
      `${DEFAULT_DENY_APP_BUNDLE_PATTERNS.length} always-denied app patterns (password managers, system security)`,
      `${DEFAULT_DENY_DOMAIN_PATTERNS.length} always-denied domain patterns (banking, payments, health, sign-in)`,
      `secure-field pauses this session: ${this.deps.securePauseCount()}`
    ];
    return {
      eventCount: storage.events.count(),
      screenshotCount: storage.screenshots.count(),
      ocrCount: storage.screenshots.ocrCount(),
      episodeCount: storage.episodes.count(),
      candidateCount: storage.candidates.count(),
      skillCount: storage.skills.countCurrent(),
      runCount: storage.runs.count(),
      feedbackCount: storage.feedback.count(),
      storedBytes: databaseBytes + blobs.bytes,
      screenshotBytes: blobs.bytes,
      databaseBytes,
      dataDirectory: this.deps.context.paths.root,
      activeExclusions: exclusions,
      queuedUploads: storage.uploadQueue.count() + storage.feedback.byStatus("queued").length
    };
  }

  deleteToday(): { deletedEvents: number; deletedScreenshots: number } {
    const outcome = runDeleteToday(this.deps.context.storage, this.deps.clock.now());
    this.deps.analytics.track("data_deleted", { scope: "today", events: outcome.deletedEvents, screenshots: outcome.deletedScreenshots });
    return { deletedEvents: outcome.deletedEvents, deletedScreenshots: outcome.deletedScreenshots };
  }

  deleteSkillData(skillId: string): boolean {
    const storage = this.deps.context.storage.current;
    const skill = storage.skills.getCurrent(skillId);
    if (!skill) throw new ServiceError("not_found", `Skill ${skillId} not found`);
    const runs = storage.runs.list(10_000).filter((run) => run.skillId === skillId);
    for (const run of runs) storage.feedback.deleteByContext("run", run.id);
    storage.runs.deleteBySkill(skillId);
    storage.skills.delete(skillId);
    if (skill.evidence.candidateId) storage.candidates.delete(skill.evidence.candidateId);
    this.deps.analytics.track("data_deleted", { scope: "skill", runs: runs.length, versions: skill.version });
    return true;
  }

  async deleteAll(confirmPhrase: string, includeSharedModelFiles: boolean): Promise<{ ok: boolean; removedPaths: string[] }> {
    if (confirmPhrase.trim().toLowerCase() !== DELETE_ALL_PHRASE) throw new ServiceError("confirmation_mismatch", `Type "${DELETE_ALL_PHRASE}" to confirm`);
    const context = this.deps.context;
    await this.deps.quiesce();
    context.storage.current.close();
    const removed = await deleteAllFiles(context.paths, includeSharedModelFiles);
    context.reopenStorage();
    this.deps.analytics.track("data_deleted", { scope: "all", paths: removed.length, includeSharedModelFiles });
    await this.deps.afterReset();
    this.deps.logger.info("all local data deleted", { paths: removed.length });
    return { ok: true, removedPaths: removed };
  }

  retentionRun(): RetentionOutcome {
    const settings = this.deps.context.settings.get();
    return runRetention(this.deps.context.storage, settings.retention, this.deps.clock.now(), { excludeSessionIds: this.deps.retentionExcludedSessions() });
  }

  private safeRetention(): void {
    try {
      const outcome = this.retentionRun();
      if (outcome.deletedEvents + outcome.deletedOcr + outcome.deletedScreenshots > 0) this.deps.logger.info("retention pass", { ...outcome });
    } catch (error) {
      this.deps.logger.error("retention pass failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }
}
