import type { CSSProperties } from "react";
import type { Appearance } from "./appearance";

/**
 * The plain image of a planet for long lists: a shaded ball in the colours of
 * the planet, drawn by CSS alone (`planet-dot` in globals.css).
 *
 * The three colours differ per planet, so they are handed to the CSS as
 * variables. That is the one thing a class cannot carry.
 *
 * It reads the same description as the detailed image (PlanetImage.tsx), so
 * the colours match, but it needs no SVG filter, no canvas and no script. A
 * page with 200 of them costs the browser next to nothing.
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
