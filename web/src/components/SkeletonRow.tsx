interface SkeletonRowProps {
  delayMs?: number;
  variant?: 0 | 1 | 2;
}

/** Shimmer block matching EmailItem anatomy (avatar circle + text bars) — 3 variants cycled */
export function SkeletonRow({ delayMs = 0, variant = 0 }: SkeletonRowProps) {
  return (
    <div className={`skeleton-row variant-${variant}`} style={{ animationDelay: `${delayMs}ms` }}>
      <span className="skeleton skeleton-avatar" aria-hidden="true" />
      <div className="skeleton-body">
        {variant === 1 ? (
          <>
            <span className="skeleton skeleton-line skeleton-line-subject" />
            <span className="skeleton-row-tags" aria-hidden="true">
              <span className="skeleton skeleton-tag" />
              <span className="skeleton skeleton-tag skeleton-tag-sm" />
            </span>
          </>
        ) : variant === 2 ? (
          <>
            <span className="skeleton-row-top" aria-hidden="true">
              <span className="skeleton skeleton-line skeleton-line-subject" />
              <span className="skeleton skeleton-date" />
            </span>
            <span className="skeleton skeleton-line" />
            <span className="skeleton skeleton-line skeleton-line-md" />
          </>
        ) : (
          <>
            <span className="skeleton skeleton-line skeleton-line-subject" />
            <span className="skeleton skeleton-line" />
          </>
        )}
      </div>
    </div>
  );
}
