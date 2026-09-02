import { safeStorage } from "electron";
import type { KeyProtector } from "../security/keys.js";

/** Electron safeStorage (macOS Keychain) as the master-key protector. */
export function createSafeStorageProtector(): KeyProtector {
  return {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: (plain) => safeStorage.encryptString(plain),
    decryptString: (encrypted) => safeStorage.decryptString(encrypted)
  };
}
