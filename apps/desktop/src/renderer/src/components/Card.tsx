import type { HTMLAttributes, JSX, ReactNode } from "react";

interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title?: ReactNode;
  actions?: ReactNode;
  selected?: boolean;
  as?: "div" | "section" | "article";
}

export function Card({ title, actions, selected = false, className = "", children, as = "section", ...rest }: CardProps): JSX.Element {
  const Tag = as;
  const classes = ["card", selected ? "card-selected" : "", className].filter(Boolean).join(" ");
  return (
    <Tag className={classes} {...rest}>
      {title || actions ? (
        <div className="card-header">
          {title ? <h3 className="card-title">{title}</h3> : <span />}
          {actions ? <div className="row">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </Tag>
  );
}
