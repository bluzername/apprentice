import { MetricsRecorder, newId } from "@apprentice/core";
import { ensureDataDirs, resolveDataPaths, type DataPaths } from "../paths.js";
import { SecretStore, loadOrCreateMasterKey, type KeyProtector } from "../security/keys.js";
import { openStorage, type Storage } from "../storage/index.js";
import { createAnalytics, type Analytics } from "./analytics.js";
import { createLogger, type Logger } from "./logger.js";
import { SettingsStore } from "./settings-store.js";
import { systemClock, type Clock } from "./clock.js";
import { join } from "node:path";

/** Mutable holder so delete-all can swap the storage underneath every service. */
export class StorageRef {
  constructor(private storage: Storage) {}

  get current(): Storage {
    return this.storage;
  }

  replace(next: Storage): void {
    this.storage = next;
  }
}

export interface AppContext {
  readonly paths: DataPaths;
  readonly protector: KeyProtector;
  readonly masterKey: () => Buffer;
  readonly storage: StorageRef;
  readonly settings: SettingsStore;
  readonly secrets: SecretStore;
  readonly sessionId: string;
  readonly installationId: () => string;
  readonly metrics: MetricsRecorder;
  readonly analytics: Analytics;
  readonly logger: Logger;
  readonly clock: Clock;
  /** Re-creates storage, master key, and settings after delete-all. */
  reopenStorage(): Storage;
}

export interface AppContextOptions {
  readonly dataDir?: string;
  readonly protector: KeyProtector;
  readonly clock?: Clock;
  readonly logger?: Logger;
  readonly logToConsole?: boolean;
}

function openWithKey(paths: DataPaths, protector: KeyProtector): { storage: Storage; key: Buffer } {
  const key = loadOrCreateMasterKey(paths.keys, protector);
  const storage = openStorage({ databasePath: paths.database, screenshotsDir: paths.screenshots, masterKey: key });
  return { storage, key };
}

/** Builds paths, keys, storage, settings, and cross-cutting services without touching Electron. */
export function createAppContext(options: AppContextOptions): AppContext {
  const paths = resolveDataPaths(options.dataDir);
  ensureDataDirs(paths);
  const logger = options.logger ?? createLogger({ filePath: join(paths.logs, "app.log"), console: options.logToConsole ?? true });
  const opened = openWithKey(paths, options.protector);
  let key = opened.key;
  const storageRef = new StorageRef(opened.storage);
  const settings = new SettingsStore(() => storageRef.current.settings);
  const sessionId = newId("sess");
  const clock = options.clock ?? systemClock;
  const metrics = new MetricsRecorder();
  const analytics = createAnalytics({
    repository: () => storageRef.current.productEvents,
    installationId: () => settings.get().installationId,
    sessionId,
    logger,
    now: () => clock.now()
  });
  const context: AppContext = {
    paths,
    protector: options.protector,
    masterKey: () => key,
    storage: storageRef,
    settings,
    secrets: new SecretStore(paths.keys, options.protector),
    sessionId,
    installationId: () => settings.get().installationId,
    metrics,
    analytics,
    logger,
    clock,
    reopenStorage: () => {
      ensureDataDirs(paths);
      const next = openWithKey(paths, options.protector);
      key = next.key;
      storageRef.replace(next.storage);
      settings.reload();
      return next.storage;
    }
  };
  return context;
}
