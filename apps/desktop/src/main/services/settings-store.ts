import { AppSettingsSchema, type AppSettings } from "@apprentice/schemas";
import type { SettingsRepository } from "../storage/repositories/settings.js";

export type SettingsListener = (next: AppSettings, previous: AppSettings) => void;

/**
 * In-memory settings cache backed by the settings table. Every update produces
 * a new validated object and notifies listeners; the previous value is untouched.
 */
export class SettingsStore {
  private current: AppSettings;
  private listeners: readonly SettingsListener[] = [];

  constructor(private readonly repository: () => SettingsRepository) {
    this.current = repository().load();
  }

  get(): AppSettings {
    return this.current;
  }

  update(patch: Partial<AppSettings>): AppSettings {
    const previous = this.current;
    const merged = AppSettingsSchema.parse({ ...previous, ...patch, installationId: previous.installationId, schemaVersion: 1 });
    this.current = this.repository().save(merged);
    for (const listener of this.listeners) listener(this.current, previous);
    return this.current;
  }

  /** Reload from the repository (after delete-all replaced the database). */
  reload(): AppSettings {
    const previous = this.current;
    this.current = this.repository().load();
    for (const listener of this.listeners) listener(this.current, previous);
    return this.current;
  }

  onChange(listener: SettingsListener): () => void {
    this.listeners = [...this.listeners, listener];
    return () => {
      this.listeners = this.listeners.filter((entry) => entry !== listener);
    };
  }
}
