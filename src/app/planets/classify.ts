export type PlanetClass = "rocky" | "super_earth" | "neptune_like" | "gas_giant";
export type ClimateClass = "frozen" | "cold" | "temperate" | "hot" | "scorching";

/**
 * Radius in Earth radii from the mass in Earth masses, using the mass-radius
 * relation of Chen & Kipping (2017). Only an estimate for planets without a
 * measured radius.
 */
export function radiusFromMass(massEarth: number): number {
  if (massEarth < 2.04) return 1.008 * massEarth ** 0.279;
  if (massEarth < 131.6) return 0.808 * massEarth ** 0.589;
  return 17.7 * massEarth ** -0.044;
}

/** Planet class from the radius. Without a radius it is estimated from the mass. */
export function classifyPlanet(
  radiusEarth: number | null,
  massEarth: number | null,
): PlanetClass | null {
  const radius =
    radiusEarth ?? (massEarth !== null ? radiusFromMass(massEarth) : null);
  if (radius === null) return null;
  if (radius < 1.25) return "rocky";
  if (radius < 2) return "super_earth";
  if (radius <= 6) return "neptune_like";
  return "gas_giant";
}

/** Climate class from the equilibrium temperature in kelvin. */
export function classifyClimate(eqTempK: number | null): ClimateClass | null {
  if (eqTempK === null) return null;
  if (eqTempK < 150) return "frozen";
  if (eqTempK < 250) return "cold";
  if (eqTempK < 350) return "temperate";
  if (eqTempK <= 1000) return "hot";
  return "scorching";
}
