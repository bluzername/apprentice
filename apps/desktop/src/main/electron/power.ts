import { powerMonitor } from "electron";
import type { PowerProbe, ThermalState } from "../services/model/model-manager.js";

const THERMAL: Readonly<Record<string, ThermalState>> = { unknown: "unknown", nominal: "nominal", fair: "fair", serious: "serious", critical: "critical" };

/** powerMonitor-backed pause conditions for local model work. */
export function createElectronPowerProbe(): PowerProbe {
  return {
    onBattery: () => powerMonitor.isOnBatteryPower(),
    thermalState: () => THERMAL[powerMonitor.getCurrentThermalState()] ?? "unknown",
    idleSeconds: () => powerMonitor.getSystemIdleTime()
  };
}
