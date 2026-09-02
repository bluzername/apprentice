import pkg from "../../../package.json";

/** Application version from package.json, bundled at build time. */
export const APP_VERSION: string = typeof pkg.version === "string" ? pkg.version : "0.0.0";
