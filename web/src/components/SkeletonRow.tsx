interface SkeletonRowProps {
  delayMs?: number;
}

/** Shimmer block matching EmailItem anatomy (avatar circle + text bars) */
export function SkeletonRow({ delayMs = 0 }: SkeletonRowProps) {
  return (
    <div className="skeleton-row" style={{ animationDelay: `${delayMs}ms` }}>
      <span className="skeleton skeleton-avatar" />
      <div className="skeleton-body">
        <span className="skeleton skeleton-line skeleton-line-sm" />
        <span className="skeleton skeleton-line" />
        <span className="skeleton skeleton-line skeleton-line-md" />
      </div>
    </div>
  );
}
