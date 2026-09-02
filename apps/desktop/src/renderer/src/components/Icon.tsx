import type { JSX } from "react";

export type IconName =
  | "overview"
  | "activity"
  | "candidates"
  | "skills"
  | "runs"
  | "feedback"
  | "privacy"
  | "settings"
  | "close"
  | "check"
  | "warning"
  | "info"
  | "chevron"
  | "play"
  | "stop"
  | "trash"
  | "plus"
  | "eye"
  | "eye-off"
  | "logo";

const PATHS: Record<IconName, JSX.Element> = {
  overview: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  activity: <><path d="M3 12h4l3-7 4 14 3-7h4" /></>,
  candidates: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  skills: <><path d="M4 4h12l4 4v12H4z" /><path d="M8 12h8M8 16h5" /></>,
  runs: <><path d="M6 4l14 8-14 8z" /></>,
  feedback: <><path d="M4 5h16v11H9l-5 4z" /></>,
  privacy: <><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M9 12l2 2 4-4" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.2 2.2M16.9 16.9l2.2 2.2M4.9 19.1l2.2-2.2M16.9 7.1l2.2-2.2" /></>,
  close: <><path d="M6 6l12 12M18 6L6 18" /></>,
  check: <><path d="M5 12l5 5 9-10" /></>,
  warning: <><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18v.5" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7v.5" /></>,
  chevron: <><path d="M9 6l6 6-6 6" /></>,
  play: <><path d="M7 5l12 7-12 7z" /></>,
  stop: <><rect x="6" y="6" width="12" height="12" rx="2" /></>,
  trash: <><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  "eye-off": <><path d="M3 3l18 18M10 6.5A10 10 0 0 1 22 12s-1.5 2.6-4 4.5M6 8C3.5 10 2 12 2 12s4 7 10 7c1.5 0 2.8-.3 4-.9" /></>,
  logo: <><path d="M12 3l9 16H3z" /><path d="M12 10v5" /></>
};

interface IconProps {
  name: IconName;
  size?: number;
  title?: string;
}

/** Inline stroke icon. Decorative unless a title is given. */
export function Icon({ name, size = 18, title }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {PATHS[name]}
    </svg>
  );
}
