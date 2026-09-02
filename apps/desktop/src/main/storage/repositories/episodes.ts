import { EpisodeSchema, type Episode } from "@apprentice/schemas";
import type { Database } from "../database.js";

export class EpisodesRepository {
  constructor(private readonly db: Database) {}

  replaceAll(episodes: readonly Episode[]): void {
    this.db.transaction(() => {
      this.db.run("DELETE FROM episodes");
      for (const e of episodes) this.upsert(e);
    });
  }

  upsert(episode: Episode): void {
    const parsed = EpisodeSchema.parse(episode);
    this.db.run("INSERT OR REPLACE INTO episodes (id, session_id, start_ts, end_ts, json) VALUES (?, ?, ?, ?, ?)", parsed.id, parsed.sessionId, parsed.startTs, parsed.endTs, JSON.stringify(parsed));
  }

  list(limit = 100): Episode[] {
    return this.db.all<{ json: string }>("SELECT json FROM episodes ORDER BY start_ts DESC LIMIT ?", limit).map((r) => EpisodeSchema.parse(JSON.parse(r.json)));
  }

  all(): Episode[] {
    return this.db.all<{ json: string }>("SELECT json FROM episodes ORDER BY start_ts ASC").map((r) => EpisodeSchema.parse(JSON.parse(r.json)));
  }

  byIds(ids: readonly string[]): Episode[] {
    if (ids.length === 0) return [];
    return this.db.all<{ json: string }>(`SELECT json FROM episodes WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY start_ts ASC`, ...ids).map((r) => EpisodeSchema.parse(JSON.parse(r.json)));
  }

  count(): number {
    return this.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM episodes")?.c ?? 0;
  }

  deleteAll(): number {
    return this.db.run("DELETE FROM episodes").changes;
  }

  deleteByIds(ids: readonly string[]): number {
    if (ids.length === 0) return 0;
    return this.db.run(`DELETE FROM episodes WHERE id IN (${ids.map(() => "?").join(",")})`, ...ids).changes;
  }
}
