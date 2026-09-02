/** Validation helpers for allowlist entries. */

export interface ValidationResult {
  ok: boolean;
  value?: string;
  message?: string;
}

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Accepts "https://Mail.Example.com/inbox" and returns "mail.example.com". */
export function normalizeDomain(input: string): string {
  let value = input.trim().toLowerCase();
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  value = value.replace(/^www\./, "");
  const slash = value.indexOf("/");
  if (slash >= 0) value = value.slice(0, slash);
  const at = value.lastIndexOf("@");
  if (at >= 0) value = value.slice(at + 1);
  const colon = value.indexOf(":");
  if (colon >= 0) value = value.slice(0, colon);
  return value.replace(/\.$/, "");
}

export function validateDomain(input: string): ValidationResult {
  const value = normalizeDomain(input);
  if (value.length === 0) return { ok: false, message: "Enter a domain such as notion.so." };
  if (value.length > 253) return { ok: false, message: "Domain is too long." };
  if (/\s/.test(value)) return { ok: false, message: "Domains cannot contain spaces." };
  const labels = value.split(".");
  if (labels.length < 2) return { ok: false, message: "Include the top-level domain, for example example.com." };
  if (!labels.every((label) => LABEL.test(label))) return { ok: false, message: "Use letters, digits and hyphens only." };
  const tld = labels[labels.length - 1];
  if (!tld || /^\d+$/.test(tld)) return { ok: false, message: "IP addresses are not supported. Use a domain name." };
  return { ok: true, value };
}

export function validateBundleId(input: string): ValidationResult {
  const value = input.trim();
  if (value.length === 0) return { ok: false, message: "Enter a bundle identifier such as com.example.App." };
  if (value.length > 256) return { ok: false, message: "Bundle identifier is too long." };
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]$/.test(value) || !value.includes(".")) {
    return { ok: false, message: "Bundle identifiers look like com.company.App (letters, digits, dots, hyphens)." };
  }
  return { ok: true, value };
}
