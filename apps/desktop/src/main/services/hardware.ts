import { execFile } from "node:child_process";
import { cpus, totalmem, arch as osArch, release } from "node:os";
import { statfs } from "node:fs/promises";
import { promisify } from "node:util";
import { HardwareInfoSchema, type HardwareInfo } from "@apprentice/schemas";

const execFileAsync = promisify(execFile);
const GB = 1024 ** 3;

export interface HardwareProbe {
  brandString(): Promise<string>;
  macosVersion(): Promise<string>;
  totalMemoryBytes(): number;
  freeDiskBytes(path: string): Promise<number>;
  arch(): string;
}

async function sysctl(key: string): Promise<string> {
  const { stdout } = await execFileAsync("sysctl", ["-n", key], { timeout: 5000 });
  return stdout.trim();
}

/** Real probe using sysctl, sw_vers, os, and statfs. Never a shell string. */
export const systemHardwareProbe: HardwareProbe = {
  brandString: async () => {
    try {
      return await sysctl("machdep.cpu.brand_string");
    } catch {
      return cpus()[0]?.model ?? "unknown";
    }
  },
  macosVersion: async () => {
    try {
      const { stdout } = await execFileAsync("sw_vers", ["-productVersion"], { timeout: 5000 });
      return stdout.trim();
    } catch {
      return release();
    }
  },
  totalMemoryBytes: () => totalmem(),
  freeDiskBytes: async (path) => {
    const stats = await statfs(path);
    return stats.bavail * stats.bsize;
  },
  arch: () => osArch()
};

export function chipFamilyFromBrand(brand: string): HardwareInfo["chipFamily"] {
  const match = /apple\s+m(\d)/i.exec(brand);
  if (match) {
    const generation = match[1];
    if (generation === "1" || generation === "2" || generation === "3" || generation === "4" || generation === "5") return `m${generation}` as HardwareInfo["chipFamily"];
    return "apple_other";
  }
  if (/apple/i.test(brand)) return "apple_other";
  return "unknown";
}

export function recommendedExperience(memoryGb: number): HardwareInfo["recommendedExperience"] {
  if (memoryGb >= 24) return "full_local_model";
  if (memoryGb >= 16) return "light_local_model";
  return "demo_or_external";
}

export function memoryBucket(memoryGb: number): "lt16" | "16" | "24" | "32" | "48plus" | "unknown" {
  if (!Number.isFinite(memoryGb) || memoryGb <= 0) return "unknown";
  if (memoryGb < 16) return "lt16";
  if (memoryGb < 24) return "16";
  if (memoryGb < 32) return "24";
  if (memoryGb < 48) return "32";
  return "48plus";
}

export async function detectHardware(dataDir: string, probe: HardwareProbe = systemHardwareProbe): Promise<HardwareInfo> {
  const [brand, macosVersion, freeDiskBytes] = await Promise.all([
    probe.brandString(),
    probe.macosVersion(),
    probe.freeDiskBytes(dataDir).catch(() => 0)
  ]);
  const memoryGb = Math.round((probe.totalMemoryBytes() / GB) * 10) / 10;
  const macosMajor = Number.parseInt(macosVersion.split(".")[0] ?? "0", 10);
  const arch = probe.arch();
  const chipFamily = chipFamilyFromBrand(brand);
  return HardwareInfoSchema.parse({
    chip: brand.slice(0, 64),
    chipFamily,
    arch: arch.slice(0, 16),
    memoryGb,
    freeDiskGb: Math.round((freeDiskBytes / GB) * 10) / 10,
    macosVersion: macosVersion.slice(0, 32),
    macosMajor: Number.isFinite(macosMajor) ? macosMajor : 0,
    recommendedExperience: recommendedExperience(memoryGb),
    isAppleSilicon: arch === "arm64" && chipFamily !== "unknown"
  });
}

/** Cached hardware info with a single detection per process. */
export class HardwareService {
  private cached: Promise<HardwareInfo> | null = null;

  constructor(
    private readonly dataDir: string,
    private readonly probe: HardwareProbe = systemHardwareProbe
  ) {}

  info(): Promise<HardwareInfo> {
    if (this.cached === null) this.cached = detectHardware(this.dataDir, this.probe);
    return this.cached;
  }
}
