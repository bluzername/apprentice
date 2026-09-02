import { globalShortcut } from "electron";

const ACCELERATOR_RE = /^((Command|Cmd|Control|Ctrl|CommandOrControl|CmdOrCtrl|Alt|Option|Shift|Super|Meta)\+)+([A-Za-z0-9]|F[1-9]|F1[0-2]|Space|Tab|Escape|Enter|Return|Up|Down|Left|Right|Home|End|PageUp|PageDown)$/;

export function isValidAccelerator(accelerator: string): boolean {
  return ACCELERATOR_RE.test(accelerator.trim());
}

export interface ShortcutController {
  registerTeach(accelerator: string): { ok: boolean; message?: string };
  registerEscape(): boolean;
  unregisterEscape(): void;
  unregisterAll(): void;
}

/** Global shortcuts: the configurable teach shortcut, and Escape only while a run is active. */
export function createShortcutController(handlers: { onTeach: () => void; onEscape: () => void }): ShortcutController {
  let teach: string | null = null;
  let escape = false;
  return {
    registerTeach(accelerator) {
      const trimmed = accelerator.trim();
      if (!isValidAccelerator(trimmed)) return { ok: false, message: `Invalid shortcut: ${trimmed}` };
      if (teach !== null && teach !== trimmed) globalShortcut.unregister(teach);
      if (teach === trimmed && globalShortcut.isRegistered(trimmed)) return { ok: true };
      const ok = globalShortcut.register(trimmed, handlers.onTeach);
      teach = ok ? trimmed : null;
      return ok ? { ok: true } : { ok: false, message: `Shortcut ${trimmed} is already taken by another app` };
    },
    registerEscape() {
      if (escape) return true;
      escape = globalShortcut.register("Escape", handlers.onEscape);
      return escape;
    },
    unregisterEscape() {
      if (!escape) return;
      globalShortcut.unregister("Escape");
      escape = false;
    },
    unregisterAll() {
      globalShortcut.unregisterAll();
      teach = null;
      escape = false;
    }
  };
}
