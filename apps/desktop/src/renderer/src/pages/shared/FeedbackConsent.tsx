import { useState, type JSX } from "react";
import { Button } from "../../components/Button";
import { Checkbox, TextInput } from "../../components/Field";
import { useStore } from "../../state/store";
import { PayloadPreviewButton } from "./PayloadPreview";
import { errorMessage } from "../../lib/hooks";

/**
 * Remote feedback consent block. Local feedback is always on; remote is opt-in
 * with a separate confirmation. Consent is persisted the moment it changes and
 * the checked state comes from settings, so what is shown is what is stored.
 * Participant code and endpoint URL are saved explicitly.
 */
export function FeedbackConsent({ compact = false }: { compact?: boolean }): JSX.Element {
  const { state, updateSettings, toast } = useStore();
  const feedback = state.settings?.feedback;
  const remoteConsent = feedback?.remoteConsent ?? false;
  /** The first box was ticked but the confirmation has not been given yet. */
  const [intent, setIntent] = useState(false);
  const [participantCode, setParticipantCode] = useState(feedback?.participantCode ?? "");
  const [endpointUrl, setEndpointUrl] = useState(feedback?.endpointUrl ?? "");
  const [consentBusy, setConsentBusy] = useState(false);
  const [detailsBusy, setDetailsBusy] = useState(false);
  const codeError = participantCode && !/^[A-Za-z0-9_-]{0,32}$/.test(participantCode) ? "Use letters, digits, hyphen or underscore (max 32)." : null;
  const urlError = endpointUrl && !/^https:\/\/.+/.test(endpointUrl) ? "Endpoint must be an https:// URL." : null;
  const consentChecked = remoteConsent || intent;
  const confirmed = remoteConsent;

  const persistConsent = async (next: boolean): Promise<void> => {
    if (next === remoteConsent) return;
    setConsentBusy(true);
    try {
      await updateSettings({ feedback: { ...(feedback ?? { pulseShown: [] }), remoteConsent: next } });
      toast("success", next ? "Saved: remote structured feedback enabled" : "Saved: remote feedback stays off");
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setConsentBusy(false);
    }
  };

  const onConsentChange = (checked: boolean): void => {
    setIntent(checked);
    if (!checked) void persistConsent(false);
  };

  const onConfirmChange = (checked: boolean): void => {
    void persistConsent(consentChecked && checked);
  };

  const saveDetails = async (): Promise<void> => {
    if (codeError || urlError) return;
    setDetailsBusy(true);
    try {
      await updateSettings({
        feedback: {
          ...(feedback ?? { pulseShown: [] }),
          remoteConsent,
          participantCode: participantCode || undefined,
          endpointUrl: endpointUrl || undefined
        }
      });
      toast("success", "Participant code and endpoint saved");
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setDetailsBusy(false);
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
        hint="Off by default. Saved as soon as you change it. You can preview the exact payload before every upload."
        checked={consentChecked}
        disabled={consentBusy}
        onCheckedChange={onConsentChange}
      />
      {consentChecked ? (
        <Checkbox
          label="I understand that structured feedback and anonymous hardware buckets will be uploaded to the endpoint below"
          hint="A separate explicit confirmation is required. Free-text comments are included only if you type them and are warned each time."
          checked={confirmed}
          disabled={consentBusy}
          onCheckedChange={onConfirmChange}
        />
      ) : null}
      <div className="grid-2">
        <TextInput label="Participant code (optional)" value={participantCode} onValueChange={setParticipantCode} error={codeError} placeholder="alpha-042" />
        <TextInput label="Feedback endpoint URL (optional)" value={endpointUrl} onValueChange={setEndpointUrl} error={urlError} placeholder="https://feedback.example.workers.dev" hint="Leave empty to use the built-in endpoint." />
      </div>
      <div className="row">
        <Button variant="primary" busy={detailsBusy} onClick={() => void saveDetails()} disabled={Boolean(codeError || urlError)}>
          Save code and endpoint
        </Button>
        <PayloadPreviewButton />
      </div>
    </div>
  );
}
