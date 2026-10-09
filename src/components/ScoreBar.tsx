interface Props {
  label: string;
  score: number; // 1-5
  feedback?: string;
}

/** Labelled 1-5 bar with an optional line of feedback underneath. */
export default function ScoreBar({ label, score, feedback }: Props) {
  const pct = Math.max(0, Math.min(100, (score / 5) * 100));
  return (
    <div className="score-bar">
      <div className="score-bar-head">
        <span>{label}</span>
        <span className="muted">{Number.isInteger(score) ? score : score.toFixed(1)}/5</span>
      </div>
      <div
        className="bar"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={5}
        aria-valuenow={score}
      >
        <div className="bar-fill" style={{ width: `${pct}%` }} />
      </div>
      {feedback && <p className="small muted">{feedback}</p>}
    </div>
  );
}
