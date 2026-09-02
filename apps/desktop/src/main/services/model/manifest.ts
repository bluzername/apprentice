import { z } from "zod";
import manifestJson from "../../../../../../scripts/model-manifest.json";

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const ModelManifestSchema = z.object({
  schemaVersion: z.number().int(),
  uiMateCommit: z.string(),
  llamaCpp: z.object({
    release: z.string(),
    assetName: z.string(),
    url: z.string().url(),
    size: z.number().int().nonnegative(),
    sha256: Sha256,
    extractedDir: z.string(),
    serverBinary: z.string(),
    expectedVersionSubstring: z.string(),
    source: z.string(),
    license: z.string()
  }),
  model: z.object({
    name: z.string(),
    alias: z.string(),
    repo: z.string(),
    hfSpec: z.string(),
    quantization: z.string(),
    license: z.string(),
    licenseHolder: z.string(),
    sourceUrls: z.array(z.string()),
    files: z.object({
      weights: z.object({ file: z.string(), url: z.string().url(), size: z.number().int().nonnegative(), sha256: Sha256 }),
      mmproj: z.object({ file: z.string(), url: z.string().url(), size: z.number().int().nonnegative(), sha256: Sha256 })
    }),
    expectedDownloadBytes: z.number().int().nonnegative(),
    expectedDiskBytes: z.number().int().nonnegative(),
    contextSize: z.number().int().positive(),
    gpuLayers: z.number().int().nonnegative(),
    imagesToKeep: z.number().int().positive(),
    memoryRecommendation: z.object({ recommendedUnifiedMemoryGb: z.number(), minimumUnifiedMemoryGb: z.number(), note: z.string() })
  })
});
export type ModelManifest = z.infer<typeof ModelManifestSchema>;

/** The pinned runtime and model manifest, bundled from scripts/model-manifest.json at build time. */
export const MODEL_MANIFEST: ModelManifest = ModelManifestSchema.parse(manifestJson);

export const MODEL_DIR_NAME = "ui-mate-9b";

export interface RuntimeInfo {
  readonly runtimeRelease: string;
  readonly runtimeSha256: string;
  readonly modelRepo: string;
  readonly modelQuant: string;
  readonly modelFile: string;
  readonly modelSha256: string;
  readonly mmprojFile: string;
  readonly mmprojSha256: string;
  readonly expectedBytes: number;
  readonly license: string;
  readonly sourceUrl: string;
  readonly runtimeUrl: string;
}

export function runtimeInfoFrom(manifest: ModelManifest): RuntimeInfo {
  return {
    runtimeRelease: manifest.llamaCpp.release,
    runtimeSha256: manifest.llamaCpp.sha256,
    modelRepo: manifest.model.repo,
    modelQuant: manifest.model.quantization,
    modelFile: manifest.model.files.weights.file,
    modelSha256: manifest.model.files.weights.sha256,
    mmprojFile: manifest.model.files.mmproj.file,
    mmprojSha256: manifest.model.files.mmproj.sha256,
    expectedBytes: manifest.model.expectedDownloadBytes,
    license: manifest.model.license,
    sourceUrl: manifest.model.sourceUrls[0] ?? "",
    runtimeUrl: manifest.llamaCpp.url
  };
}
