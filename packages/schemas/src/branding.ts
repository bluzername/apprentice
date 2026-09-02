/**
 * Central product identity. Change the product name here and nowhere else.
 * Every user-facing string, bundle identifier, data directory, and protocol
 * identifier derives from these constants.
 */
export const PRODUCT_NAME = "Apprentice";
export const PRODUCT_ID = "apprentice";
export const PRODUCT_TAGLINE = "A local-first work agent that learns your routines and asks before it acts.";
export const APP_BUNDLE_ID = "com.apprentice.alpha";
export const HELPER_EXECUTABLE_NAME = "apprentice-helper";
export const APP_SUPPORT_DIR_NAME = PRODUCT_NAME;
export const FEEDBACK_BUNDLE_EXTENSION = ".apprentice-feedback.zip";
export const EXTENSION_NAME = `${PRODUCT_NAME} Browser Companion`;

export const SCHEMA_VERSION = 1;
export const HELPER_PROTOCOL_VERSION = "1.0";
export const EXTENSION_PROTOCOL_VERSION = "1.0";
export const FEEDBACK_PAYLOAD_VERSION = "1.0";
export const IPC_CONTRACT_VERSION = "1.0";

/** Default loopback port range the extension probes to find the desktop app. */
export const LOOPBACK_PORT_RANGE = { start: 47815, end: 47825 } as const;
export const LOOPBACK_HOST = "127.0.0.1";

export const DEFAULT_TEACH_SHORTCUT = "Alt+Command+L";
