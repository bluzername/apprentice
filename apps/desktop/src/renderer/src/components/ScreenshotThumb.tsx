import { useState, type JSX } from "react";
import { invoke } from "../lib/api";

interface ScreenshotThumbProps {
  id: string;
  width: number;
  height: number;
  maxWidth?: number;
  label?: string;
}

interface Loaded {
  src: string;
}

/**
 * Lazy screenshot. Nothing is fetched until the user clicks; the image is
 * blurred by CSS until revealed and can be hidden again.
 */
export function ScreenshotThumb({ id, width, height, maxWidth = 240, label }: ScreenshotThumbProps): JSX.Element {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ratio = height / Math.max(1, width);
  const displayWidth = Math.min(maxWidth, width);
  const displayHeight = Math.round(displayWidth * ratio);

  const toggle = async (): Promise<void> => {
    if (loaded) {
      setRevealed((r) => !r);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const shot = await invoke("screenshot:get", { id });
      setLoaded({ src: `data:image/png;base64,${shot.pngBase64}` });
      setRevealed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load screenshot");
    } finally {
      setBusy(false);
    }
  };

  const blurred = !loaded || !revealed;
  return (
    <button
      type="button"
      className={`shot ${blurred ? "shot-blurred" : ""}`.trim()}
      style={{ width: displayWidth }}
      onClick={() => void toggle()}
      aria-pressed={!blurred}
      aria-label={blurred ? `Reveal screenshot${label ? ` ${label}` : ""}` : `Hide screenshot${label ? ` ${label}` : ""}`}
      disabled={busy}
    >
      {loaded ? (
        <img src={loaded.src} width={displayWidth} height={displayHeight} alt={label ? `Screenshot: ${label}` : "Screenshot"} />
      ) : (
        <div className="shot-placeholder" style={{ width: displayWidth, height: displayHeight }}>
          {busy ? "Decrypting" : error ? error : displayWidth < 140 ? "Blurred" : "Blurred. Click to reveal"}
        </div>
      )}
      <span className="shot-label">{blurred ? "Blurred" : "Visible"}</span>
    </button>
  );
}
