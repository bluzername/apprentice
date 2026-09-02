/** Generates the Manifest V3 document from branding constants and package.json. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXTENSION_NAME, PRODUCT_NAME, PRODUCT_TAGLINE } from "@apprentice/schemas";

export const PERMISSIONS = ["storage", "scripting", "downloads", "alarms", "tabs"] as const;
export const OPTIONAL_HOST_PERMISSIONS = ["https://*/*", "http://*/*"] as const;
export const ICON_SIZES = [16, 48, 128] as const;

export interface ExtensionManifest {
  readonly manifest_version: 3;
  readonly name: string;
  readonly short_name: string;
  readonly description: string;
  readonly version: string;
  readonly version_name?: string;
  readonly minimum_chrome_version: string;
  readonly incognito: "not_allowed";
  readonly permissions: readonly string[];
  readonly optional_host_permissions: readonly string[];
  readonly background: { readonly service_worker: string; readonly type: "module" };
  readonly action: { readonly default_popup: string; readonly default_title: string; readonly default_icon: Record<string, string> };
  readonly icons: Record<string, string>;
}

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));

/** Chrome requires 1-4 dot-separated integers; alpha suffixes go to version_name. */
export function chromeVersionFrom(packageVersion: string): { version: string; versionName?: string } {
  const match = /^(\d+(?:\.\d+){0,3})(.*)$/.exec(packageVersion.trim());
  if (match === null || match[1] === undefined) {
    throw new Error(`Cannot derive a Chrome version from "${packageVersion}"`);
  }
  const suffix = match[2] ?? "";
  return suffix.length > 0 ? { version: match[1], versionName: packageVersion.trim() } : { version: match[1] };
}

export function buildManifest(packageVersion: string): ExtensionManifest {
  const { version, versionName } = chromeVersionFrom(packageVersion);
  const icons = Object.fromEntries(ICON_SIZES.map((size) => [String(size), `icons/icon-${size}.png`]));
  return {
    manifest_version: 3,
    name: EXTENSION_NAME,
    short_name: PRODUCT_NAME,
    description: `${PRODUCT_TAGLINE} Talks only to the ${PRODUCT_NAME} app on 127.0.0.1.`,
    version,
    ...(versionName ? { version_name: versionName } : {}),
    minimum_chrome_version: "120",
    incognito: "not_allowed",
    permissions: [...PERMISSIONS],
    optional_host_permissions: [...OPTIONAL_HOST_PERMISSIONS],
    background: { service_worker: "background.js", type: "module" },
    action: { default_popup: "popup.html", default_title: EXTENSION_NAME, default_icon: icons },
    icons
  };
}

export async function readPackageVersion(): Promise<string> {
  const raw = await readFile(join(packageDir, "package.json"), "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || typeof (parsed as { version?: unknown }).version !== "string") {
    throw new Error("package.json has no string version");
  }
  return (parsed as { version: string }).version;
}

export async function writeManifest(distDir: string): Promise<string> {
  const manifest = buildManifest(await readPackageVersion());
  await mkdir(distDir, { recursive: true });
  const target = join(distDir, "manifest.json");
  await writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return target;
}

const invokedDirectly = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  writeManifest(join(packageDir, "dist"))
    .then((target) => console.log(`manifest written: ${target}`))
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
