import { useState, type JSX } from "react";
import { Button } from "../../components/Button";
import { TextInput } from "../../components/Field";
import { acceleratorLabel, validateAccelerator } from "../../lib/accelerator";
import { errorMessage } from "../../lib/hooks";
import { useStore } from "../../state/store";

export function ShortcutField(): JSX.Element {
  const { state, updateSettings, toast } = useStore();
  const current = state.settings?.shortcuts.teach ?? "";
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  const result = validateAccelerator(value);
  const dirty = (result.normalized ?? value) !== current;

  const save = async (): Promise<void> => {
    if (!result.ok || !result.normalized) return;
    setBusy(true);
    try {
      await updateSettings({ shortcuts: { teach: result.normalized } });
      setValue(result.normalized);
      toast("success", `Shortcut set to ${acceleratorLabel(result.normalized)}`);
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <TextInput label='"Learn what I just did" shortcut' value={value} onValueChange={setValue} error={value && !result.ok ? (result.message ?? null) : null} hint={result.ok && result.normalized ? `Registered globally as ${acceleratorLabel(result.normalized)}. Electron accelerator syntax, for example Alt+Command+L.` : "Electron accelerator syntax, for example Alt+Command+L."} spellCheck={false} autoComplete="off" />
      <div>
        <Button type="submit" variant="primary" busy={busy} disabled={!result.ok || !dirty}>
          Save shortcut
        </Button>
      </div>
    </form>
  );
}
