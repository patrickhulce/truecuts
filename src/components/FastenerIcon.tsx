type FastenerIconProps = {
  kind: "screw" | "nail" | "glue" | "bolt" | "bracket" | "connector" | "none";
};

export function FastenerIcon({ kind }: FastenerIconProps) {
  if (kind === "none") {
    return (
      <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true">
        <line
          x1="3"
          y1="12"
          x2="21"
          y2="12"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeDasharray="1.5 2.5"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (kind === "bracket") {
    return (
      <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true">
        <path fill="currentColor" d="M4 4h16v4H8v12H4V4z" />
      </svg>
    );
  }
  if (kind === "bolt") {
    return (
      <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true">
        <polygon points="12,2 16.2,4.4 16.2,8.4 12,10.8 7.8,8.4 7.8,4.4" fill="currentColor" />
        <path fill="currentColor" d="M10.2 8.2h3.6V16h-3.6z" />
        <polygon points="12,15.2 16.2,17.6 16.2,21.2 12,23.2 7.8,21.2 7.8,17.6" fill="currentColor" />
      </svg>
    );
  }
  if (kind === "nail") {
    return (
      <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true">
        <rect x="6" y="3" width="12" height="2.4" rx="0.4" fill="currentColor" />
        <path fill="currentColor" d="M11 5.4h2V20.2l-1 1.4-1-1.4z" />
      </svg>
    );
  }
  if (kind === "connector") {
    return (
      <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true">
        <path fill="currentColor" d="M3 4h18v4H14v12h-4V8H3V4z" />
      </svg>
    );
  }
  if (kind === "glue") {
    return (
      <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 2.2c.6 2.2 4.2 6.2 4.2 10.1a4.2 4.2 0 1 1-8.4 0C7.8 8.4 11.4 4.4 12 2.2z"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true">
      <ellipse cx="12" cy="5.8" rx="7" ry="2.5" fill="currentColor" />
      <path fill="currentColor" d="M9.2 7.1 10.4 21h3.2l1.2-13.9z" />
      <path d="M8 5.8h8" stroke="#1a120b" strokeWidth="1.2" />
    </svg>
  );
}
