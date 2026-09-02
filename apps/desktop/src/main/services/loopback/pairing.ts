import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { hashToken, type PairingRepository } from "../../storage/repositories/pairing.js";

export const PAIRING_CODE_TTL_MS = 5 * 60 * 1000;
export const PAIRING_MAX_ATTEMPTS = 5;

export interface PairingCode {
  readonly code: string;
  readonly expiresAt: number;
  readonly attempts: number;
}

export type PairOutcome = { readonly ok: true; readonly token: string } | { readonly ok: false; readonly reason: "no_code" | "expired" | "mismatch" | "locked" };

/** One-time six-digit code, five-minute validity, five attempts, hashed bearer token. */
export class PairingManager {
  private active: PairingCode | null = null;

  constructor(
    private readonly repository: () => PairingRepository,
    private readonly now: () => number
  ) {}

  issue(): PairingCode {
    this.active = { code: String(randomInt(0, 1_000_000)).padStart(6, "0"), expiresAt: this.now() + PAIRING_CODE_TTL_MS, attempts: 0 };
    return this.active;
  }

  current(): PairingCode | null {
    if (this.active && this.active.expiresAt <= this.now()) this.active = null;
    return this.active;
  }

  attempt(code: string, extensionId: string, browser: string): PairOutcome {
    const active = this.current();
    if (!active) return { ok: false, reason: "no_code" };
    if (active.attempts >= PAIRING_MAX_ATTEMPTS) {
      this.active = null;
      return { ok: false, reason: "locked" };
    }
    const expected = Buffer.from(active.code, "utf8");
    const provided = Buffer.from(code, "utf8");
    const matches = expected.length === provided.length && timingSafeEqual(expected, provided);
    if (!matches) {
      this.active = { ...active, attempts: active.attempts + 1 };
      if (this.active.attempts >= PAIRING_MAX_ATTEMPTS) this.active = null;
      return { ok: false, reason: this.active === null ? "locked" : "mismatch" };
    }
    const token = randomBytes(32).toString("base64url");
    this.repository().set({ tokenHash: hashToken(token), extensionId, browser, createdAt: this.now() });
    this.active = null;
    return { ok: true, token };
  }

  /** Constant-time comparison of the presented token against the stored hash. */
  verifyToken(token: string): boolean {
    const record = this.repository().get();
    if (!record) return false;
    const stored = Buffer.from(record.tokenHash, "hex");
    const presented = Buffer.from(hashToken(token), "hex");
    return stored.length === presented.length && timingSafeEqual(stored, presented);
  }

  clear(): void {
    this.active = null;
    this.repository().clear();
  }
}
