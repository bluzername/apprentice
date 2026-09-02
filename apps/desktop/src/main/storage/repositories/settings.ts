import { AppSettingsSchema, type AppSettings } from "@apprentice/schemas";
import { randomBytes } from "node:crypto";
import type { Database } from "../database.js";

export function defaultSettings(installationId = randomBytes(16).toString("hex")): AppSettings {
  return AppSettingsSchema.parse({
    installationId,
    allowlist: { apps: [], domains: [] },
    learning: { state: "stopped" },
    model: { providerType: "mock" },
    feedback: { remoteConsent: false },
    shortcuts: {},
    experimental: { lowRiskAuto: false }
  });
}

export class SettingsRepository {
  constructor(private readonly db: Database) {}

  load(): AppSettings {
    const row = this.db.get<{ json: string }>("SELECT json FROM settings WHERE id = 1");
    if (!row) {
      const fresh = defaultSettings();
      this.save(fresh);
      return fresh;
    }
    const parsed = AppSettingsSchema.safeParse(JSON.parse(row.json));
    if (parsed.success) return parsed.data;
    // Recover from an incompatible settings blob while keeping the installation id.
    const raw = JSON.parse(row.json) as { installationId?: string };
    const fresh = defaultSettings(typeof raw.installationId === "string" && /^[a-f0-9]{16,64}$/.test(raw.installationId) ? raw.installationId : undefined);
    this.save(fresh);
    return fresh;
  }

  save(settings: AppSettings): AppSettings {
    const parsed = AppSettingsSchema.parse(settings);
    this.db.run("INSERT INTO settings (id, json, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at", JSON.stringify(parsed), Date.now());
    return parsed;
  }

  update(patch: Partial<AppSettings>): AppSettings {
    const current = this.load();
    const merged = AppSettingsSchema.parse({ ...current, ...patch, installationId: current.installationId, schemaVersion: 1 });
    return this.save(merged);
  }

  /** Reset everything except the installation id (used by delete-all). */
  reset(): AppSettings {
    const current = this.load();
    return this.save(defaultSettings(current.installationId));
  }
}

export class MetaRepository {
  constructor(private readonly db: Database) {}

  get(key: string): string | null {
    return this.db.get<{ value: string }>("SELECT value FROM meta WHERE key = ?", key)?.value ?? null;
  }

  set(key: string, value: string): void {
    this.db.run("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value);
  }

  delete(key: string): void {
    this.db.run("DELETE FROM meta WHERE key = ?", key);
  }
}
