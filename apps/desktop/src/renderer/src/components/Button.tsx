import type { ButtonHTMLAttributes, JSX, MouseEvent, Ref } from "react";

type Variant = "default" | "primary" | "danger" | "ghost" | "stop";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** In-flight state: the button stays focusable and announces itself as disabled, clicks are ignored. */
  busy?: boolean;
  block?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

const VARIANT_CLASS: Record<Variant, string> = {
  default: "",
  primary: "btn-primary",
  danger: "btn-danger",
  ghost: "btn-ghost",
  stop: "btn-stop"
};

export function Button({ variant = "default", size = "md", busy = false, block = false, className = "", children, disabled, type = "button", onClick, ...rest }: ButtonProps): JSX.Element {
  const classes = ["btn", VARIANT_CLASS[variant], size === "sm" ? "btn-sm" : size === "lg" ? "btn-lg" : "", block ? "btn-block" : "", className].filter(Boolean).join(" ");
  const handleClick = (e: MouseEvent<HTMLButtonElement>): void => {
    if (busy) {
      e.preventDefault();
      return;
    }
    onClick?.(e);
  };
  return (
    <button type={type} className={classes} disabled={disabled} aria-disabled={busy ? "true" : undefined} aria-busy={busy || undefined} onClick={handleClick} {...rest}>
      {busy ? <span className="spinner" aria-hidden="true" /> : null}
      {children}
      {busy ? <span className="visually-hidden">Working</span> : null}
    </button>
  );
}
