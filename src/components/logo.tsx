export function Logo({ size = 28, className }: { size?: number; className?: string }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden>
      {/* moon */}
      <circle cx="16" cy="12.5" r="7.5" stroke="var(--accent)" strokeWidth="2" />
      <circle cx="13.2" cy="10.6" r="2.2" fill="var(--accent)" opacity="0.55" />
      {/* water ripples */}
      <path
        d="M3 23.5c3.3 0 3.3 2.5 6.5 2.5s3.2-2.5 6.5-2.5 3.2 2.5 6.5 2.5 3.2-2.5 6.5-2.5"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.85"
      />
      <path
        d="M6.5 28.2c2.4 0 2.4 1.8 4.75 1.8s2.35-1.8 4.75-1.8 2.35 1.8 4.75 1.8 2.35-1.8 4.75-1.8"
        stroke="var(--accent)"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.4"
      />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }): React.JSX.Element {
  return (
    <span className={className}>
      <span className="font-display font-semibold tracking-tight text-ink">moon</span>
      <span className="font-display font-semibold tracking-tight text-accent text-glow">pool</span>
    </span>
  );
}
