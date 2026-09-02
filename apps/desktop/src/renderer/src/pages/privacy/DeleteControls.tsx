import { useCallback, useState, type JSX } from "react";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { ConfirmDialog, Dialog } from "../../components/Dialog";
import { Checkbox, Select, TextInput } from "../../components/Field";
import { invoke } from "../../lib/api";
import { errorMessage, useLoader } from "../../lib/hooks";
import { useStore } from "../../state/store";

const DELETE_PHRASE = "delete everything";

export function DeleteControls({ onChanged }: { onChanged: () => void }): JSX.Element {
  const { toast, reloadSettings } = useStore();
  const skillsLoader = useCallback(() => invoke("skills:list"), []);
  const { data: skills } = useLoader(skillsLoader);
  const [confirmToday, setConfirmToday] = useState(false);
  const [skillId, setSkillId] = useState("");
  const [confirmSkill, setConfirmSkill] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [includeModel, setIncludeModel] = useState(false);
  const [modelConfirmed, setModelConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (label: string, fn: () => Promise<string>): Promise<void> => {
    setBusy(true);
    try {
      toast("success", await fn());
      onChanged();
    } catch (err) {
      toast("error", `${label}: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
      setConfirmToday(false);
      setConfirmSkill(false);
      setAllOpen(false);
      setPhrase("");
      setIncludeModel(false);
      setModelConfirmed(false);
    }
  };

  const phraseOk = phrase.trim().toLowerCase() === DELETE_PHRASE;
  const allEnabled = phraseOk && (!includeModel || modelConfirmed);

  return (
    <Card title="Delete data" className="danger-zone">
      <div className="stack">
        <div className="row-between">
          <span>Delete everything captured today (events, screenshots, OCR).</span>
          <Button variant="danger" size="sm" onClick={() => setConfirmToday(true)}>
            Delete today
          </Button>
        </div>
        <div className="row-between">
          <div className="row" style={{ flex: 1 }}>
            <Select label="Delete data for one workflow" value={skillId} onValueChange={setSkillId} options={[{ value: "", label: "Choose a skill" }, ...(skills ?? []).map((s) => ({ value: s.id, label: `${s.name} (v${s.version})` }))]} />
          </div>
          <Button variant="danger" size="sm" disabled={!skillId} onClick={() => setConfirmSkill(true)}>
            Delete selected workflow
          </Button>
        </div>
        <div className="row-between">
          <span>Delete all local data: activity, episodes, candidates, skills, runs, feedback and keys.</span>
          <Button variant="danger" size="sm" onClick={() => setAllOpen(true)}>
            Delete all local data
          </Button>
        </div>
      </div>
      <ConfirmDialog open={confirmToday} title="Delete today's data?" message="All events, screenshots and OCR captured since midnight will be removed permanently." confirmLabel="Delete today" danger busy={busy} onCancel={() => setConfirmToday(false)} onConfirm={() => void run("Delete today", async () => { const r = await invoke("privacy:deleteToday"); return `Deleted ${r.deletedEvents} events and ${r.deletedScreenshots} screenshots`; })} />
      <ConfirmDialog open={confirmSkill} title="Delete this workflow's data?" message="The skill, its versions, the evidence episodes it references and its runs will be removed permanently." confirmLabel="Delete workflow data" danger busy={busy} onCancel={() => setConfirmSkill(false)} onConfirm={() => void run("Delete workflow", async () => { await invoke("privacy:deleteSkillData", { skillId }); setSkillId(""); return "Workflow data deleted"; })} />
      <Dialog
        open={allOpen}
        title="Delete all local data"
        onClose={() => setAllOpen(false)}
        footer={
          <>
            <Button onClick={() => setAllOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" busy={busy} disabled={!allEnabled} onClick={() => void run("Delete all", async () => { const r = await invoke("privacy:deleteAll", { confirmPhrase: phrase.trim().toLowerCase(), includeSharedModelFiles: includeModel }); await reloadSettings(); return `Removed ${r.removedPaths.length} locations`; })}>
              Delete everything
            </Button>
          </>
        }
      >
        <div className="stack">
          <div className="callout callout-danger">This removes every event, screenshot, episode, candidate, skill, run, feedback record, setting and encryption key on this Mac. It cannot be undone. The app will return to setup.</div>
          <TextInput label={`Type "${DELETE_PHRASE}" to enable the button`} value={phrase} onValueChange={setPhrase} autoComplete="off" spellCheck={false} />
          <Checkbox label="Also delete shared model files (runtime and downloaded weights)" hint="These are large downloads shared with other tools. Deleting them means re-downloading later." checked={includeModel} onCheckedChange={(c) => { setIncludeModel(c); if (!c) setModelConfirmed(false); }} />
          {includeModel ? <Checkbox label="I confirm the shared model files should be deleted too" checked={modelConfirmed} onCheckedChange={setModelConfirmed} /> : null}
        </div>
      </Dialog>
    </Card>
  );
}
