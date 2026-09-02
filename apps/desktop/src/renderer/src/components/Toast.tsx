import type { JSX } from "react";
import { Button } from "./Button";
import { Icon } from "./Icon";

export type ToastKind = "info" | "success" | "warning" | "error";

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastRegionProps {
  toasts: ReadonlyArray<ToastItem>;
  onDismiss: (id: number) => void;
}

/**
 * Always mounted so assistive technology registers the live region before the
 * first toast is added; an empty region announces nothing.
 */
export function ToastRegion({ toasts, onDismiss }: ToastRegionProps): JSX.Element {
  return (
    <div className="toast-region" aria-live="polite" aria-relevant="additions">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === "error" ? "alert" : "status"}>
          <span>{t.message}</span>
          <Button variant="ghost" size="sm" aria-label="Dismiss notification" onClick={() => onDismiss(t.id)}>
            <Icon name="close" size={14} />
          </Button>
        </div>
      ))}
    </div>
  );
}
