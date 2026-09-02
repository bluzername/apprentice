import { useEffect, useId, useRef, type JSX, type ReactNode, type RefObject } from "react";
import { Button } from "./Button";
import { Icon } from "./Icon";

interface DialogProps {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  closeLabel?: string;
  /** Element to focus when the dialog opens. Defaults to the first focusable element. */
  initialFocus?: RefObject<HTMLElement | null>;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Modal dialog built on the native element; adds an explicit Tab trap and focus restore. */
export function Dialog({ open, title, onClose, children, footer, wide = false, closeLabel = "Close", initialFocus }: DialogProps): JSX.Element | null {
  const ref = useRef<HTMLDialogElement>(null);
  const previousFocus = useRef<Element | null>(null);
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      previousFocus.current = document.activeElement;
      el.showModal();
      const preferred = initialFocus?.current;
      const first = el.querySelector<HTMLElement>(FOCUSABLE);
      (preferred ?? first ?? el).focus();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open, initialFocus]);

  useEffect(() => {
    if (!open) return;
    return () => {
      const prev = previousFocus.current;
      if (prev instanceof HTMLElement) prev.focus();
    };
  }, [open]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent<HTMLDialogElement>): void => {
    if (e.key !== "Tab" || !ref.current) return;
    const nodes = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? "dialog-wide" : ""}`.trim()}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={onKeyDown}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="dialog-header">
        <h2 id={titleId} style={{ fontSize: "var(--text-lg)" }}>
          {title}
        </h2>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label={closeLabel}>
          <Icon name="close" />
        </Button>
      </div>
      <div className="dialog-body">{children}</div>
      {footer ? <div className="dialog-footer">{footer}</div> : null}
    </dialog>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirmation dialog. Destructive confirmations focus Cancel first so Enter does not destroy anything by accident. */
export function ConfirmDialog({ open, title, message, confirmLabel = "Confirm", danger = false, busy = false, onConfirm, onCancel }: ConfirmDialogProps): JSX.Element | null {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open={open}
      title={title}
      onClose={onCancel}
      initialFocus={danger ? cancelRef : undefined}
      footer={
        <>
          <Button ref={cancelRef} onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} busy={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div>{message}</div>
    </Dialog>
  );
}
