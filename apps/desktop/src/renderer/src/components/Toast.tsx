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

export function ToastRegion({ toasts, onDismiss }: ToastRegionProps): JSX.Element | null {
  if (toasts.length === 0) return null;
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
