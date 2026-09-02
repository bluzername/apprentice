import { useState, type JSX } from "react";
import { Button } from "../../components/Button";
import { Checkbox, TextInput } from "../../components/Field";
import { useStore } from "../../state/store";
import { PayloadPreviewButton } from "./PayloadPreview";
import { errorMessage } from "../../lib/hooks";

/** Remote feedback consent block. Local feedback is always on; remote is opt-in with a separate confirmation. */
export function FeedbackConsent({ compact = false }: { compact?: boolean }): JSX.Element {
  const { state, updateSettings, toast } = useStore();
  const feedback = state.settings?.feedback;
  const [consentChecked, setConsentChecked] = useState(feedback?.remoteConsent ?? false);
  const [confirmed, setConfirmed] = useState(feedback?.remoteConsent ?? false);
  const [participantCode, setParticipantCode] = useState(feedback?.participantCode ?? "");
  const [endpointUrl, setEndpointUrl] = useState(feedback?.endpointUrl ?? "");
  const [busy, setBusy] = useState(false);
  const codeError = participantCode && !/^[A-Za-z0-9_-]{0,32}$/.test(participantCode) ? "Use letters, digits, hyphen or underscore (max 32)." : null;
  const urlError = endpointUrl && !/^https:\/\/.+/.test(endpointUrl) ? "Endpoint must be an https:// URL." : null;
  const wantsRemote = consentChecked && confirmed;

  const save = async (): Promise<void> => {
    if (codeError || urlError) return;
    setBusy(true);
    try {
      await updateSettings({
        feedback: {
          ...(feedback ?? { pulseShown: [] }),
          remoteConsent: wantsRemote,
          participantCode: participantCode || undefined,
          endpointUrl: endpointUrl || undefined
        }
      });
      toast("success", wantsRemote ? "Remote structured feedback enabled" : "Remote feedback stays off");
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      {!compact ? (
        <div className="callout">
          <strong>Local feedback is always stored on this Mac.</strong> It never leaves unless you turn on remote upload below. Remote upload sends only structured answers, counts and hardware buckets, never screenshots, OCR, URLs, titles or typed text.
        </div>
      ) : null}
      <Checkbox
        label="Send structured feedback to the alpha programme"
        hint="Off by default. You can preview the exact payload before every upload."
        checked={consentChecked}
        onCheckedChange={(checked) => {
          setConsentChecked(checked);
          if (!checked) setConfirmed(false);
        }}
      />
      {consentChecked ? (
        <Checkbox
          label="I understand that structured feedback and anonymous hardware buckets will be uploaded to the endpoint below"
          hint="A separate explicit confirmation is required. Free-text comments are included only if you type them and are warned each time."
          checked={confirmed}
          onCheckedChange={setConfirmed}
        />
      ) : null}
      <div className="grid-2">
        <TextInput label="Participant code (optional)" value={participantCode} onValueChange={setParticipantCode} error={codeError} placeholder="alpha-042" />
        <TextInput label="Feedback endpoint URL (optional)" value={endpointUrl} onValueChange={setEndpointUrl} error={urlError} placeholder="https://feedback.example.workers.dev" hint="Leave empty to use the built-in endpoint." />
      </div>
      <div className="row">
        <Button variant="primary" busy={busy} onClick={() => void save()} disabled={Boolean(codeError || urlError)}>
          Save consent
        </Button>
        <PayloadPreviewButton />
      </div>
    </div>
  );
}
