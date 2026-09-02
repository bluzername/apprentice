/**
 * electron-builder afterPack hook: when no signing identity was used, apply an
 * ad hoc signature so the bundle has a valid (unidentified) code signature and
 * the hardened-runtime entitlements. Runs before dmg/zip creation.
 */
const { execFileSync } = require("node:child_process");
const { join } = require("node:path");
const { existsSync } = require("node:fs");

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = join(context.appOutDir, appName);
  if (!existsSync(appPath)) return;
  const identityUsed = process.env.CSC_NAME || process.env.CSC_LINK;
  if (identityUsed && process.env.CSC_IDENTITY_AUTO_DISCOVERY !== "false") return;
  const entitlements = join(context.packager.projectDir, "resources", "entitlements.mac.plist");
  const helper = join(appPath, "Contents", "Resources", "helper", "apprentice-helper");
  if (existsSync(helper)) {
    execFileSync("codesign", ["--force", "--sign", "-", "--options", "runtime", "--timestamp=none", helper], { stdio: "inherit" });
  }
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", "--options", "runtime", "--timestamp=none", "--entitlements", entitlements, appPath], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "inherit" });
  console.log(`  • ad hoc signed ${appName} (no Developer ID identity available)`);
};
