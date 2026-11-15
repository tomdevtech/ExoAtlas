/**
 * The ExoFinder mark: a planet in transit in front of its star, the way most
 * exoplanets were found. The same drawing as icon.svg (the browser tab), so a
 * change here belongs there too.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <radialGradient id="exofinder-logo-star" cx="40%" cy="38%" r="65%">
          <stop offset="0" stopColor="#fff6e0" />
          <stop offset="0.6" stopColor="#f4e6c4" />
          <stop offset="1" stopColor="#ffd98a" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="28" fill="url(#exofinder-logo-star)" />
      <circle cx="43.5" cy="39.6" r="10.8" fill="var(--background)" stroke="var(--accent)" strokeWidth="2" />
    </svg>
  );
}
