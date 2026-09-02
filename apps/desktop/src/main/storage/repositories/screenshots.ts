import { OcrResultSchema, ScreenshotRecordSchema, type OcrResult, type ScreenshotRecord } from "@apprentice/schemas";
import type { Database } from "../database.js";
import type { PayloadCipher } from "../cipher.js";

export class ScreenshotsRepository {
  constructor(private readonly db: Database, private readonly cipher: PayloadCipher) {}

  insert(record: ScreenshotRecord): void {
    const parsed = ScreenshotRecordSchema.parse(record);
    this.db.run(
      "INSERT OR REPLACE INTO screenshots (id, ts, session_id, event_id, phash, analyzed, byte_length, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      parsed.id, parsed.ts, parsed.sessionId, parsed.eventId ?? null, parsed.perceptualHash, parsed.analyzed ? 1 : 0, parsed.byteLength, JSON.stringify(parsed)
    );
  }

  get(id: string): ScreenshotRecord | null {
    const row = this.db.get<{ json: string }>("SELECT json FROM screenshots WHERE id = ?", id);
    return row ? ScreenshotRecordSchema.parse(JSON.parse(row.json)) : null;
  }

  byIds(ids: readonly string[]): ScreenshotRecord[] {
    if (ids.length === 0) return [];
    const rows = this.db.all<{ json: string }>(`SELECT json FROM screenshots WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY ts ASC`, ...ids);
    return rows.map((r) => ScreenshotRecordSchema.parse(JSON.parse(r.json)));
  }

  inRange(fromTs: number, toTs: number): ScreenshotRecord[] {
    const rows = this.db.all<{ json: string }>("SELECT json FROM screenshots WHERE ts >= ? AND ts <= ? ORDER BY ts ASC", fromTs, toTs);
    return rows.map((r) => ScreenshotRecordSchema.parse(JSON.parse(r.json)));
  }

  latestHash(): string | null {
    return this.db.get<{ phash: string }>("SELECT phash FROM screenshots ORDER BY ts DESC LIMIT 1")?.phash ?? null;
  }

  markAnalyzed(id: string): void {
    const row = this.get(id);
    if (!row) return;
    const updated = { ...row, analyzed: true };
    this.db.run("UPDATE screenshots SET analyzed = 1, json = ? WHERE id = ?", JSON.stringify(updated), id);
  }

  count(): number {
    return this.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM screenshots")?.c ?? 0;
  }

  inventory(): { id: string; ts: number; analyzed: boolean }[] {
    return this.db.all<{ id: string; ts: number; analyzed: number }>("SELECT id, ts, analyzed FROM screenshots").map((r) => ({ id: r.id, ts: r.ts, analyzed: r.analyzed === 1 }));
  }

  deleteByIds(ids: readonly string[]): number {
    if (ids.length === 0) return 0;
    let deleted = 0;
    this.db.transaction(() => {
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        deleted += this.db.run(`DELETE FROM screenshots WHERE id IN (${chunk.map(() => "?").join(",")})`, ...chunk).changes;
        this.db.run(`DELETE FROM ocr WHERE screenshot_id IN (${chunk.map(() => "?").join(",")})`, ...chunk);
      }
    });
    return deleted;
  }

  idsInRange(fromTs: number, toTs: number): string[] {
    return this.db.all<{ id: string }>("SELECT id FROM screenshots WHERE ts >= ? AND ts <= ?", fromTs, toTs).map((r) => r.id);
  }

  allIds(): string[] {
    return this.db.all<{ id: string }>("SELECT id FROM screenshots").map((r) => r.id);
  }

  deleteAll(): number {
    this.db.run("DELETE FROM ocr");
    return this.db.run("DELETE FROM screenshots").changes;
  }

  // ---- OCR (encrypted payload) ----
  insertOcr(result: OcrResult): void {
    const parsed = OcrResultSchema.parse(result);
    this.db.run("INSERT OR REPLACE INTO ocr (id, screenshot_id, ts, json_enc) VALUES (?, ?, ?, ?)", parsed.id, parsed.screenshotId, parsed.ts, this.cipher.encryptJson(parsed));
  }

  getOcrForScreenshot(screenshotId: string): OcrResult | null {
    const row = this.db.get<{ json_enc: Uint8Array }>("SELECT json_enc FROM ocr WHERE screenshot_id = ? ORDER BY ts DESC LIMIT 1", screenshotId);
    return row ? OcrResultSchema.parse(this.cipher.decryptJson(Buffer.from(row.json_enc))) : null;
  }

  ocrCount(): number {
    return this.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM ocr")?.c ?? 0;
  }

  ocrInventory(): { id: string; ts: number }[] {
    return this.db.all<{ id: string; ts: number }>("SELECT id, ts FROM ocr");
  }

  deleteOcrByIds(ids: readonly string[]): number {
    if (ids.length === 0) return 0;
    let deleted = 0;
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      deleted += this.db.run(`DELETE FROM ocr WHERE id IN (${chunk.map(() => "?").join(",")})`, ...chunk).changes;
    }
    return deleted;
  }
}
