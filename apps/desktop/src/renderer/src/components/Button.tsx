import type { ButtonHTMLAttributes, JSX } from "react";

type Variant = "default" | "primary" | "danger" | "ghost" | "stop";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  busy?: boolean;
  block?: boolean;
}

const VARIANT_CLASS: Record<Variant, string> = {
  default: "",
  primary: "btn-primary",
  danger: "btn-danger",
  ghost: "btn-ghost",
  stop: "btn-stop"
};

export function Button({ variant = "default", size = "md", busy = false, block = false, className = "", children, disabled, type = "button", ...rest }: ButtonProps): JSX.Element {
  const classes = ["btn", VARIANT_CLASS[variant], size === "sm" ? "btn-sm" : size === "lg" ? "btn-lg" : "", block ? "btn-block" : "", className].filter(Boolean).join(" ");
  return (
    <button type={type} className={classes} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy ? <span className="spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
