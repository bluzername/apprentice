import type { JSX, MouseEvent, ReactNode } from "react";

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  width?: string;
}

interface TableProps<T> {
  columns: ReadonlyArray<Column<T>>;
  rows: ReadonlyArray<T>;
  rowKey: (row: T) => string;
  /**
   * Mouse convenience only: rows are not focusable. Give keyboard users a real
   * link or button inside the row (typically in the first column).
   */
  onRowClick?: (row: T) => void;
  caption?: string;
  emptyMessage?: string;
}

const INTERACTIVE = "a, button, input, select, textarea, label";

export function Table<T>({ columns, rows, rowKey, onRowClick, caption, emptyMessage = "Nothing to show." }: TableProps<T>): JSX.Element {
  const handleRowClick = (row: T) => (e: MouseEvent<HTMLTableRowElement>) => {
    if (!onRowClick) return;
    if (e.target instanceof Element && e.target.closest(INTERACTIVE)) return;
    onRowClick(row);
  };
  return (
    <div className="table-wrap">
      <table className="table">
        {caption ? <caption className="visually-hidden">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" style={c.width ? { width: c.width } : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="muted">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)} className={onRowClick ? "row-clickable" : undefined} onClick={onRowClick ? handleRowClick(row) : undefined}>
                {columns.map((c) => (
                  <td key={c.key}>{c.render(row)}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
