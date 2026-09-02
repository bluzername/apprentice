import { z } from "zod";
import { DEFAULT_TEACH_SHORTCUT } from "./branding.js";
import { ProviderTypeSchema } from "./model.js";

export const LearningStateSchema = z.enum(["learning", "paused", "private", "stopped"]);
export type LearningState = z.infer<typeof LearningStateSchema>;

/** Status shown in the menu bar. Derived from learning state and model state. */
export const MenuBarStatusSchema = z.enum([
  "learning",
  "paused",
  "private",
  "processing_locally",
  "model_unavailable",
  "stopped"
]);
export type MenuBarStatus = z.infer<typeof MenuBarStatusSchema>;

export const AllowedAppSchema = z.object({
  bundleId: z.string().min(1).max(256),
  name: z.string().min(1).max(128)
});
export type AllowedApp = z.infer<typeof AllowedAppSchema>;

export const RetentionSettingsSchema = z.object({
  screenshotHours: z.number().int().min(1).max(24).default(24),
  ocrDays: z.number().int().min(1).max(7).default(7),
  eventsDays: z.number().int().min(1).max(30).default(30)
});
export type RetentionSettings = z.infer<typeof RetentionSettingsSchema>;

export const AppSettingsSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  installationId: z.string().regex(/^[a-f0-9]{16,64}$/),
  onboardingCompleted: z.boolean().default(false),
  onboardingStep: z.number().int().min(0).max(7).default(0),
  demoMode: z.boolean().default(false),
  allowlist: z.object({
    apps: z.array(AllowedAppSchema).default([]),
    domains: z.array(z.string().max(253)).default([])
  }),
  learning: z.object({
    state: LearningStateSchema.default("stopped"),
    pausedUntil: z.number().int().optional()
  }),
  retention: RetentionSettingsSchema.default({ screenshotHours: 24, ocrDays: 7, eventsDays: 30 }),
  model: z.object({
    providerType: ProviderTypeSchema.default("mock"),
    endpoint: z
      .object({
        baseUrl: z.string().max(256),
        model: z.string().max(128),
        hasApiKey: z.boolean().default(false),
        imagesToKeep: z.number().int().min(1).max(10).default(2)
      })
      .optional(),
    managedRuntime: z.boolean().default(false),
    onlyOnPower: z.boolean().default(false),
    onlyWhenIdle: z.boolean().default(false)
  }),
  feedback: z.object({
    remoteConsent: z.boolean().default(false),
    endpointUrl: z.string().max(256).optional(),
    participantCode: z.string().max(32).optional(),
    firstRunTs: z.number().int().optional(),
    pulseShown: z.array(z.number().int()).default([]),
    lastPulsePromptTs: z.number().int().optional()
  }),
  shortcuts: z.object({
    teach: z.string().max(64).default(DEFAULT_TEACH_SHORTCUT)
  }),
  experimental: z.object({
    lowRiskAuto: z.boolean().default(false)
  }),
  appearance: z.enum(["system", "light", "dark"]).default("system"),
  captureViaHelper: z.boolean().default(false)
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;

type StripDefaults<S extends z.ZodRawShape> = { [K in keyof S]: S[K] extends z.ZodDefault<infer Inner extends z.ZodType> ? Inner : S[K] };

function stripDefaults<S extends z.ZodRawShape>(shape: S): StripDefaults<S> {
  return Object.fromEntries(Object.entries(shape).map(([key, schema]) => [key, schema instanceof z.ZodDefault ? schema.removeDefault() : schema])) as StripDefaults<S>;
}

/**
 * Partial update sent by the renderer. Top-level defaults are stripped on purpose:
 * `AppSettingsSchema.partial()` would re-apply them (for example `demoMode: false`)
 * to every patch and silently reset fields the caller did not mention.
 */
export const SettingsPatchSchema = z.object(stripDefaults(AppSettingsSchema.shape)).partial().omit({ installationId: true, schemaVersion: true });
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

export const HardwareInfoSchema = z.object({
  chip: z.string().max(64),
  chipFamily: z.enum(["m1", "m2", "m3", "m4", "m5", "apple_other", "unknown"]),
  arch: z.string().max(16),
  memoryGb: z.number().nonnegative(),
  freeDiskGb: z.number().nonnegative(),
  macosVersion: z.string().max(32),
  macosMajor: z.number().int(),
  recommendedExperience: z.enum(["full_local_model", "light_local_model", "demo_or_external"]),
  isAppleSilicon: z.boolean()
});
export type HardwareInfo = z.infer<typeof HardwareInfoSchema>;

export const PermissionsStatusSchema = z.object({
  accessibility: z.enum(["granted", "denied", "not_determined", "unknown"]),
  screenRecording: z.enum(["granted", "denied", "not_determined", "unknown"]),
  helperAvailable: z.boolean()
});
export type PermissionsStatus = z.infer<typeof PermissionsStatusSchema>;

export const SUGGESTED_APPS: readonly AllowedApp[] = [
  { bundleId: "com.google.Chrome", name: "Google Chrome" },
  { bundleId: "company.thebrowser.Browser", name: "Arc" },
  { bundleId: "com.brave.Browser", name: "Brave" },
  { bundleId: "com.microsoft.edgemac", name: "Microsoft Edge" },
  { bundleId: "com.apple.Safari", name: "Safari" },
  { bundleId: "com.apple.mail", name: "Mail" },
  { bundleId: "com.apple.finder", name: "Finder" },
  { bundleId: "notion.id", name: "Notion" },
  { bundleId: "com.tinyspeck.slackmacgap", name: "Slack" },
  { bundleId: "com.apple.Notes", name: "Notes" },
  { bundleId: "com.apple.iCal", name: "Calendar" },
  { bundleId: "com.apple.Preview", name: "Preview" },
  { bundleId: "com.microsoft.Excel", name: "Microsoft Excel" },
  { bundleId: "com.linear", name: "Linear" }
];

/** Domains and apps that are always denied regardless of the allowlist. */
export const DEFAULT_DENY_DOMAIN_PATTERNS: readonly string[] = [
  "1password.com",
  "lastpass.com",
  "bitwarden.com",
  "dashlane.com",
  "keepersecurity.com",
  "bankofamerica.com",
  "chase.com",
  "wellsfargo.com",
  "citi.com",
  "paypal.com",
  "venmo.com",
  "stripe.com",
  "coinbase.com",
  "binance.com",
  "wise.com",
  "revolut.com",
  "myhealth",
  "mychart.com",
  "healthcare.gov",
  "patientportal",
  "accounts.google.com",
  "login.microsoftonline.com",
  "appleid.apple.com",
  "id.apple.com",
  "auth0.com",
  "okta.com"
];

export const DEFAULT_DENY_APP_BUNDLE_PATTERNS: readonly string[] = [
  "com.1password",
  "com.agilebits",
  "com.lastpass",
  "com.bitwarden",
  "com.dashlane",
  "com.apple.keychainaccess",
  "com.apple.Passwords",
  "com.apple.SecurityAgent",
  "com.apple.loginwindow",
  "com.apple.systempreferences",
  "com.apple.SystemSettings"
];
