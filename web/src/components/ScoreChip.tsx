interface ScoreChipProps {
  score: number;
  reason?: string | undefined;
  tooltipId: string;
  prefix?: string;
}

export function ScoreChip({ score, reason, tooltipId, prefix = '' }: ScoreChipProps) {
  const tone = score >= 70 ? '' : score >= 40 ? ' mid' : ' low';
  return (
    <span className="chip-wrap">
      <span
        className={`score-chip${tone}`}
        tabIndex={0}
        {...(reason ? { 'aria-describedby': tooltipId } : {})}
      >
        {prefix}
        {Math.round(score)}
      </span>
      {reason && (
        <span className="chip-tooltip" id={tooltipId} role="tooltip">
          {reason}
        </span>
      )}
    </span>
  );
}
