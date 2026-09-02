import { describe, expect, it } from "vitest";
import { MANIFEST_PATH, ManifestError, loadManifest, validateManifest } from "./manifest.mjs";

describe("model manifest", () => {
  it("loads and validates the checked-in manifest with the verified pins", () => {
    const manifest = loadManifest();
    expect(MANIFEST_PATH).toMatch(/scripts\/model-manifest\.json$/);
    expect(manifest.llamaCpp.release).toBe("b10752");
    expect(manifest.llamaCpp.size).toBe(11072747);
    expect(manifest.llamaCpp.sha256).toBe("3c2057747f1d3c618d818960524151e48797d3b7f19fbebacc00124d930e3028");
    expect(manifest.model.files.weights.size).toBe(7700259968);
    expect(manifest.model.files.weights.sha256).toBe("d43523385746a24991f6c84761a34564104ec474041f77987ca9bf660130a971");
    expect(manifest.model.files.mmproj.sha256).toBe("5a8380c4637dddceed9dbc28fffcdfa8601909c0ece9fe218fbd6888ec5d2c16");
    expect(manifest.uiMateCommit).toBe("1cb9e1e44ce856e23b593992b02efbd489943fcb");
    expect(manifest.mlxVlmVersion).toBe("0.6.17");
    expect(manifest.mlxPins["mlx-vlm"]).toBe("0.6.17");
    expect(manifest.model.expectedDownloadBytes).toBe(7700259968 + 918166016);
  });

  it("throws on missing fields", () => {
    const manifest = loadManifest();
    const broken = structuredClone(manifest);
    delete broken.llamaCpp.sha256;
    expect(() => validateManifest(broken)).toThrow(ManifestError);
    expect(() => validateManifest(broken)).toThrow(/llamaCpp\.sha256/);
    const noPins = structuredClone(manifest);
    delete noPins.mlxPins;
    expect(() => validateManifest(noPins)).toThrow(/mlxPins/);
  });

  it("throws on malformed values", () => {
    const manifest = loadManifest();
    const badHash = { ...manifest, model: { ...manifest.model, files: { ...manifest.model.files, mmproj: { ...manifest.model.files.mmproj, sha256: "abc" } } } };
    expect(() => validateManifest(badHash)).toThrow(/mmproj\.sha256/);
    const badUrl = { ...manifest, llamaCpp: { ...manifest.llamaCpp, url: "http://insecure" } };
    expect(() => validateManifest(badUrl)).toThrow(/llamaCpp\.url/);
    const badSum = { ...manifest, model: { ...manifest.model, expectedDownloadBytes: 1 } };
    expect(() => validateManifest(badSum)).toThrow(/expectedDownloadBytes/);
    expect(() => validateManifest(null)).toThrow(ManifestError);
    expect(() => loadManifest("/nonexistent/manifest.json")).toThrow(ManifestError);
  });
});
