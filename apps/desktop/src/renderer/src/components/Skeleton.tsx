import type { JSX } from "react";

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  lines?: number;
}

export function Skeleton({ width = "100%", height = 14, lines = 1 }: SkeletonProps): JSX.Element {
  return (
    <div className="stack-sm" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton" style={{ width: i === lines - 1 && lines > 1 ? "70%" : width, height }} />
      ))}
    </div>
  );
}

export function CardSkeleton({ count = 3 }: { count?: number }): JSX.Element {
  return (
    <div className="stack" role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card">
          <Skeleton width="40%" height={18} />
          <div style={{ height: 10 }} />
          <Skeleton lines={3} />
        </div>
      ))}
    </div>
  );
}
