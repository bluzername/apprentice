import { describe, expect, it } from "vitest";
import { compareVersions, parseRequirement, pickPin, resolveMlxPins, satisfies } from "./pypi.mjs";

describe("pypi helpers", () => {
  it("parses PEP 508 requirements", () => {
    expect(parseRequirement("mlx>=0.32.0")).toEqual({ name: "mlx", extras: [], specifiers: [{ op: ">=", version: "0.32.0" }], marker: null });
    expect(parseRequirement('gradio>=5.19.0; extra == "ui"')).toMatchObject({ name: "gradio", marker: 'extra == "ui"' });
    expect(parseRequirement("uvicorn")).toMatchObject({ name: "uvicorn", specifiers: [] });
    expect(parseRequirement("Pillow>=10.3.0,<12")).toMatchObject({ name: "pillow", specifiers: [{ op: ">=", version: "10.3.0" }, { op: "<", version: "12" }] });
  });

  it("compares versions and evaluates specifiers", () => {
    expect(compareVersions("0.32.2", "0.32.0")).toBe(1);
    expect(compareVersions("5.14", "5.14.0")).toBe(0);
    expect(satisfies("5.16.1", [{ op: ">=", version: "5.14.0" }])).toBe(true);
    expect(satisfies("5.13.9", [{ op: ">=", version: "5.14.0" }])).toBe(false);
    expect(satisfies("1.4.9", [{ op: "~=", version: "1.4.2" }])).toBe(true);
    expect(satisfies("1.5.0", [{ op: "~=", version: "1.4.2" }])).toBe(false);
  });

  it("picks the newest stable satisfying version", () => {
    expect(pickPin(["0.31.0", "0.32.0", "0.32.2", "0.33.0rc1", "0.32.1"], [{ op: ">=", version: "0.32.0" }])).toBe("0.32.2");
    expect(pickPin(["0.31.0"], [{ op: ">=", version: "0.32.0" }])).toBeNull();
  });

  it("resolves mlx pins from requires_dist using an injected fetch", async () => {
    const responses = {
      "https://pypi.org/pypi/mlx-vlm/0.6.17/json": {
        info: { version: "0.6.17", requires_python: ">=3.10", requires_dist: ["mlx>=0.32.0", "transformers>=5.14.0", 'gradio>=5.19.0; extra == "ui"'] },
        urls: []
      },
      "https://pypi.org/pypi/mlx/json": {
        info: { version: "0.32.2" },
        releases: {
          "0.31.0": [{ filename: "mlx-0.31.0-cp313-cp313-macosx_15_0_arm64.whl" }],
          "0.32.2": [{ filename: "mlx-0.32.2-cp313-cp313-macosx_15_0_arm64.whl" }],
          "0.33.0": [{ filename: "mlx-0.33.0-cp313-cp313-manylinux_2_35_x86_64.whl" }]
        }
      },
      "https://pypi.org/pypi/transformers/json": {
        info: { version: "5.16.1" },
        releases: { "5.13.0": [{ filename: "transformers-5.13.0-py3-none-any.whl" }], "5.16.1": [{ filename: "transformers-5.16.1-py3-none-any.whl" }] }
      }
    };
    const fetchImpl = async (url) => ({ ok: true, status: 200, json: async () => responses[url] });
    const resolved = await resolveMlxPins("0.6.17", { fetchImpl });
    expect(resolved.pins).toEqual({ "mlx-vlm": "0.6.17", mlx: "0.32.2", transformers: "5.16.1" });
    expect(resolved.requiresPython).toBe(">=3.10");
  });
});
