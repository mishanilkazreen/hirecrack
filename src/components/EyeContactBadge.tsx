interface Props {
  face: boolean;
  looking: boolean;
}

export default function EyeContactBadge({ face, looking }: Props) {
  const state = !face ? 'none' : looking ? 'good' : 'away';
  const text = !face ? 'No face detected' : looking ? 'Looking at camera' : 'Looking away';
  return (
    <span className={`badge badge-${state}`} role="status">
      <span className="dot" aria-hidden="true" />
      {text}
    </span>
  );
}
