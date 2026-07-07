export interface CountdownRingProps {
  /** Elapsed fraction of the window, 0..1. */
  progress: number;
  /** Milliseconds left in the window. */
  remaining: number;
  /** Outer size in pixels. Default: 32. */
  size?: number;
  /** Ring stroke width in pixels. Default: 3. */
  strokeWidth?: number;
}

/** SVG countdown ring. The arc drains as the grace window elapses. */
export function CountdownRing({ progress, remaining, size = 32, strokeWidth = 3 }: CountdownRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const fractionLeft = Math.max(0, Math.min(1, 1 - progress));
  const seconds = Math.max(0, Math.ceil(remaining / 1000));

  return (
    <svg
      className="rev-ring"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="timer"
      aria-label={`${seconds} seconds to undo`}
    >
      <circle
        className="rev-ring-track"
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={strokeWidth}
      />
      <circle
        className="rev-ring-arc"
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - fractionLeft)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        className="rev-ring-label"
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        fontSize={size * 0.38}
        aria-hidden="true"
      >
        {seconds}
      </text>
    </svg>
  );
}
