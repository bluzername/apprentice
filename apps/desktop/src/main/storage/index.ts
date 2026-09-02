import { Database } from "./database.js";
import { PayloadCipher } from "./cipher.js";
import { BlobStore } from "./blob-store.js";
import { EventsRepository } from "./repositories/events.js";
import { ScreenshotsRepository } from "./repositories/screenshots.js";
import { EpisodesRepository } from "./repositories/episodes.js";
import { CandidatesRepository } from "./repositories/candidates.js";
import { SkillsRepository } from "./repositories/skills.js";
import { RunsRepository } from "./repositories/runs.js";
import { FeedbackRepository, ProductEventsRepository } from "./repositories/feedback.js";
import { MetaRepository, SettingsRepository } from "./repositories/settings.js";
import { PairingRepository, UploadQueueRepository } from "./repositories/pairing.js";

export interface Storage {
  readonly db: Database;
  readonly cipher: PayloadCipher;
  readonly blobs: BlobStore;
  readonly events: EventsRepository;
  readonly screenshots: ScreenshotsRepository;
  readonly episodes: EpisodesRepository;
  readonly candidates: CandidatesRepository;
  readonly skills: SkillsRepository;
  readonly runs: RunsRepository;
  readonly feedback: FeedbackRepository;
  readonly productEvents: ProductEventsRepository;
  readonly settings: SettingsRepository;
  readonly meta: MetaRepository;
  readonly pairing: PairingRepository;
  readonly uploadQueue: UploadQueueRepository;
  close(): void;
}

export function openStorage(options: { databasePath: string; screenshotsDir: string; masterKey: Buffer }): Storage {
  const db = new Database(options.databasePath);
  db.migrate();
  const cipher = new PayloadCipher(options.masterKey);
  const blobs = new BlobStore(options.screenshotsDir, cipher);
  return Object.freeze({
    db,
    cipher,
    blobs,
    events: new EventsRepository(db, cipher),
    screenshots: new ScreenshotsRepository(db, cipher),
    episodes: new EpisodesRepository(db),
    candidates: new CandidatesRepository(db),
    skills: new SkillsRepository(db),
    runs: new RunsRepository(db),
    feedback: new FeedbackRepository(db),
    productEvents: new ProductEventsRepository(db),
    settings: new SettingsRepository(db),
    meta: new MetaRepository(db),
    pairing: new PairingRepository(db),
    uploadQueue: new UploadQueueRepository(db),
    close: () => db.close()
  });
}

export { Database, PayloadCipher, BlobStore };
export * from "./repositories/events.js";
export * from "./repositories/screenshots.js";
export * from "./repositories/episodes.js";
export * from "./repositories/candidates.js";
export * from "./repositories/skills.js";
export * from "./repositories/runs.js";
export * from "./repositories/feedback.js";
export * from "./repositories/settings.js";
export * from "./repositories/pairing.js";
