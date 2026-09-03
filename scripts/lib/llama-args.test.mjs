import { describe, expect, it } from "vitest";
import { baseUrlForPort, buildHfServerArgs, buildLocalServerArgs, healthUrlForPort } from "./llama-args.mjs";

describe("llama-server argument arrays", () => {
  it("builds the exact local-model argument array", () => {
    const args = buildLocalServerArgs({
      modelPath: "/data/models/ui-mate-9b/tencent_UI-Mate-9B-Q6_K.gguf",
      mmprojPath: "/data/models/ui-mate-9b/mmproj-tencent_UI-Mate-9B-f16.gguf",
      port: 51234,
      logPath: "/data/logs/llama-server.log"
    });
    expect(args).toEqual([
      "-m",
      "/data/models/ui-mate-9b/tencent_UI-Mate-9B-Q6_K.gguf",
      "--mmproj",
      "/data/models/ui-mate-9b/mmproj-tencent_UI-Mate-9B-f16.gguf",
      "--host",
      "127.0.0.1",
      "--port",
      "51234",
      "-ngl",
      "99",
      "-c",
      "32768",
      "--alias",
      "UI_Mate",
      "--log-file",
      "/data/logs/llama-server.log"
    ]);
    expect(args.every((a) => typeof a === "string")).toBe(true);
  });

  it("keeps paths with spaces and shell metacharacters as single elements", () => {
    const modelPath = "/Users/me/Library/Application Support/Apprentice/models/x; rm -rf $HOME | cat.gguf";
    const args = buildLocalServerArgs({ modelPath, mmprojPath: "/m m.gguf", port: 8000, logPath: "/l og.log" });
    expect(args[1]).toBe(modelPath);
    expect(args[3]).toBe("/m m.gguf");
    expect(args.at(-1)).toBe("/l og.log");
    expect(args.some((a) => a.includes(" -m ") || a.includes("--mmproj "))).toBe(false);
  });

  it("builds the official -hf form", () => {
    expect(buildHfServerArgs({ hfSpec: "bartowski/tencent_UI-Mate-9B-GGUF:Q6_K", port: 8000, logPath: "/x.log" })).toEqual([
      "-hf",
      "bartowski/tencent_UI-Mate-9B-GGUF:Q6_K",
      "--host",
      "127.0.0.1",
      "--port",
      "8000",
      "-ngl",
      "99",
      "-c",
      "32768",
      "--alias",
      "UI_Mate",
      "--log-file",
      "/x.log"
    ]);
  });

  it("validates inputs and only produces loopback URLs", () => {
    expect(() => buildLocalServerArgs({ modelPath: "", mmprojPath: "/m", port: 1, logPath: "/l" })).toThrow(TypeError);
    expect(() => buildLocalServerArgs({ modelPath: "/m", mmprojPath: "/p", port: 70000, logPath: "/l" })).toThrow(TypeError);
    expect(() => buildLocalServerArgs({ modelPath: "/m", mmprojPath: "/p", port: "8000", logPath: "/l" })).toThrow(TypeError);
    expect(baseUrlForPort(8000)).toBe("http://127.0.0.1:8000/v1");
    expect(healthUrlForPort(8000)).toBe("http://127.0.0.1:8000/health");
  });
});
