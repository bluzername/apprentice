export interface SensitiveDictionary {
  readonly reason: string;
  readonly terms: readonly string[];
}

export const SENSITIVE_DICTIONARIES: readonly SensitiveDictionary[] = [
  { reason: "password", terms: ["password", "passcode", "passphrase", "master password", "pin code"] },
  {
    reason: "verification_code",
    terms: ["2fa", "two-factor", "two factor", "verification code", "one-time code", "one time code",
      "one-time password", "security code", "authenticator", "confirmation code", "otp"]
  },
  {
    reason: "payment_details",
    terms: ["credit card", "debit card", "card number", "cvv", "cvc", "expiry date", "expiration date",
      "routing number", "account number", "iban", "bank account", "sort code", "swift code"]
  },
  { reason: "identity_number", terms: ["ssn", "social security", "passport number", "national id", "tax id"] },
  {
    reason: "system_authentication",
    terms: ["wants to make changes", "touch id", "enter your password to allow", "administrator password",
      "unlock with", "is trying to", "allow this app", "keychain"]
  },
  { reason: "private_browsing", terms: ["incognito", "private browsing", "private window", "inprivate"] }
];

/** Only trusted in window titles; page bodies mention "sign in" far too often. */
export const SIGN_IN_TERMS: readonly string[] = ["sign in", "sign-in", "log in", "login", "signin", "authenticate"];

export const SECURE_AX_ROLES: readonly string[] = ["axsecuretextfield", "secure-text-field", "securetextfield", "password"];
