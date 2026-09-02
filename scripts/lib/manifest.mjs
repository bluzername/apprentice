/**
 * Loads and validates scripts/model-manifest.json. Every pin the installers
 * rely on must be present and well formed; a missing field is a hard error.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const MANIFEST_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "model-manifest.json");

const SHA256_RE = /^[0-9a-f]{64}$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const VERSION_RE = /^\d+(\.\d+)*$/;

const REQUIRED_FIELDS = [
  ["schemaVersion", "int"],
  ["uiMateCommit", "commit"],
  ["mlxVlmVersion", "version"],
  ["mlxPins", "object"],
  ["mlxPins.mlx-vlm", "version"],
  ["mlxPins.mlx", "version"],
  ["mlxPins.transformers", "version"],
  ["appSupportDir.note", "string"],
  ["appSupportDir.envOverride", "string"],
  ["llamaCpp.release", "string"],
  ["llamaCpp.assetName", "string"],
  ["llamaCpp.url", "httpsUrl"],
  ["llamaCpp.size", "int"],
  ["llamaCpp.sha256", "sha256"],
  ["llamaCpp.extractedDir", "string"],
  ["llamaCpp.serverBinary", "string"],
  ["llamaCpp.expectedVersionSubstring", "string"],
  ["llamaCpp.source", "httpsUrl"],
  ["llamaCpp.license", "string"],
  ["model.name", "string"],
  ["model.alias", "string"],
  ["model.repo", "string"],
  ["model.hfSpec", "string"],
  ["model.upstreamRepo", "string"],
  ["model.license", "string"],
  ["model.licenseHolder", "string"],
  ["model.sourceUrls", "array"],
  ["model.files.weights.file", "string"],
  ["model.files.weights.url", "httpsUrl"],
  ["model.files.weights.size", "int"],
  ["model.files.weights.sha256", "sha256"],
  ["model.files.mmproj.file", "string"],
  ["model.files.mmproj.url", "httpsUrl"],
  ["model.files.mmproj.size", "int"],
  ["model.files.mmproj.sha256", "sha256"],
  ["model.expectedDownloadBytes", "int"],
  ["model.expectedDiskBytes", "int"],
  ["model.contextSize", "int"],
  ["model.gpuLayers", "int"],
  ["model.imagesToKeep", "int"],
  ["model.memoryRecommendation.recommendedUnifiedMemoryGb", "int"],
  ["mlx.hfPath", "string"],
  ["mlx.outputDirName", "string"],
  ["mlx.quantBits", "int"],
  ["mlx.groupSize", "int"],
  ["mlx.env", "object"],
  ["mlx.patchPolicy", "string"]
];

function getPath(obj, path) {
  return path.split(".").reduce((acc, key) => (acc === undefined || acc === null ? undefined : acc[key]), obj);
}

function checkType(value, type) {
  switch (type) {
    case "string":
      return typeof value === "string" && value.length > 0;
    case "int":
      return Number.isInteger(value) && value >= 0;
    case "sha256":
      return typeof value === "string" && SHA256_RE.test(value);
    case "commit":
      return typeof value === "string" && COMMIT_RE.test(value);
    case "version":
      return typeof value === "string" && VERSION_RE.test(value);
    case "httpsUrl":
      return typeof value === "string" && value.startsWith("https://");
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "array":
      return Array.isArray(value) && value.length > 0;
    default:
      throw new Error(`Unknown manifest field type ${type}`);
  }
}

export class ManifestError extends Error {
  constructor(message) {
    super(message);
    this.name = "ManifestError";
  }
}

export function validateManifest(manifest) {
  if (typeof manifest !== "object" || manifest === null) {
    throw new ManifestError("Manifest must be a JSON object");
  }
  const problems = REQUIRED_FIELDS.filter(([path, type]) => !checkType(getPath(manifest, path), type)).map(
    ([path, type]) => `${path} (expected ${type})`
  );
  if (problems.length > 0) {
    throw new ManifestError(`Invalid model manifest, missing or malformed fields: ${problems.join(", ")}`);
  }
  const expected = manifest.model.files.weights.size + manifest.model.files.mmproj.size;
  if (manifest.model.expectedDownloadBytes !== expected) {
    throw new ManifestError(
      `model.expectedDownloadBytes (${manifest.model.expectedDownloadBytes}) must equal the sum of file sizes (${expected})`
    );
  }
  if (manifest.mlxPins["mlx-vlm"] !== manifest.mlxVlmVersion) {
    throw new ManifestError("mlxPins.mlx-vlm must match mlxVlmVersion");
  }
  return manifest;
}

export function loadManifest(path = MANIFEST_PATH) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new ManifestError(`Could not read model manifest at ${path}: ${error.message}`);
  }
  return validateManifest(parsed);
}
