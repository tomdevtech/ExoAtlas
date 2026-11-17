import type { CSSProperties } from "react";
import type { Appearance } from "./appearance";

/**
 * Cheap planet thumbnail for long lists: a shaded ball drawn by CSS alone (`planet-dot` in globals.css).
 * It reads the same appearance as PlanetImage.tsx, so the colours match, but it needs no SVG filter, canvas or
 * script, so 200 per page cost next to nothing. The per-planet colours are passed as CSS variables.
 */
export function PlanetDot({
  appearance,
  className = "size-7",
}: {
  appearance: Appearance;
  /** Sets the size. The ball fills whatever box it gets. */
  className?: string;
}) {
  const { base, layers, banded } = appearance;
  const colors = {
    "--planet-base": base,
    "--planet-dark": layers[0]?.color ?? base,
    "--planet-light": layers[1]?.color ?? base,
  } as CSSProperties;
  return (
    <span
      aria-hidden
      className={`${banded ? "planet-dot-banded" : "planet-dot"} block shrink-0 rounded-full ${className}`}
      style={colors}
    />
  );
}
