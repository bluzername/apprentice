import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { MIGRATIONS } from "./migrations.js";

export type SqlParam = SQLInputValue;
export type Row = Record<string, SqlParam>;

/**
 * Thin adapter over node:sqlite so the rest of the app never depends on the
 * driver directly (see ADR 0003).
 */
export class Database {
  private readonly db: DatabaseSync;
  readonly path: string;

  constructor(path: string) {
    this.path = path;
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = NORMAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA busy_timeout = 5000");
  }

  static openInMemory(): Database {
    return new Database(":memory:");
  }

  migrate(): { applied: number; version: number } {
    this.db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)");
    const current = this.get<{ v: number | null }>("SELECT MAX(version) AS v FROM schema_migrations")?.v ?? 0;
    let applied = 0;
    for (const migration of MIGRATIONS) {
      if (migration.version <= current) continue;
      this.transaction(() => {
        this.db.exec(migration.sql);
        this.run("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)", migration.version, migration.name, Date.now());
      });
      applied += 1;
    }
    const version = this.get<{ v: number | null }>("SELECT MAX(version) AS v FROM schema_migrations")?.v ?? 0;
    return { applied, version };
  }

  run(sql: string, ...params: SqlParam[]): { changes: number; lastInsertRowid: number | bigint } {
    const result = this.db.prepare(sql).run(...params);
    return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid };
  }

  get<T = Row>(sql: string, ...params: SqlParam[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  all<T = Row>(sql: string, ...params: SqlParam[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /** Total bytes used by the database file(s) as reported by SQLite. */
  sizeBytes(): number {
    const pageCount = this.get<{ page_count: number }>("PRAGMA page_count")?.page_count ?? 0;
    const pageSize = this.get<{ page_size: number }>("PRAGMA page_size")?.page_size ?? 0;
    return pageCount * pageSize;
  }

  close(): void {
    this.db.close();
  }
}
