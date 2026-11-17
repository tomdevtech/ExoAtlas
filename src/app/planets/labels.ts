import type { ClimateClass, PlanetClass } from "./classify";

export const PLANET_CLASS_ORDER: PlanetClass[] = [
  "rocky",
  "super_earth",
  "neptune_like",
  "gas_giant",
];

export const PLANET_CLASS_LABELS: Record<PlanetClass, string> = {
  rocky: "Rocky planet",
  super_earth: "Super-Earth",
  neptune_like: "Neptune-like planet",
  gas_giant: "Gas giant",
};

export const PLANET_CLASS_PLURALS: Record<PlanetClass, string> = {
  rocky: "Rocky planets",
  super_earth: "Super-Earths",
  neptune_like: "Neptune-like planets",
  gas_giant: "Gas giants",
};

export const CLIMATE_CLASS_LABELS: Record<ClimateClass, string> = {
  frozen: "frozen",
  cold: "cold",
  temperate: "temperate",
  hot: "hot",
  scorching: "scorching",
};

/** Label of a planet class, such as "Super-Earth", or "Planet" when radius and mass are both unknown. */
export function planetClassLabel(planetClass: PlanetClass | null): string {
  return planetClass ? PLANET_CLASS_LABELS[planetClass] : "Planet";
}

/** Short description such as "Super-Earth, temperate". Unknown parts are left out. */
export function describePlanet(
  planetClass: PlanetClass | null,
  climateClass: ClimateClass | null,
): string {
  const label = planetClassLabel(planetClass);
  return climateClass ? `${label}, ${CLIMATE_CLASS_LABELS[climateClass]}` : label;
}

/** Names of the tracked fields as they appear in the change history. */
export const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  status: "Status",
  star: "Host star",
  discoveryMethod: "Discovery method",
  discoveryYear: "Discovery year",
  discoveryFacility: "Discovery facility",
  orbitalPeriodDays: "Orbital period (days)",
  semiMajorAxisAu: "Semi-major axis (AU)",
  eccentricity: "Eccentricity",
  radiusEarth: "Radius (Earth radii)",
  radiusCalculated: "Radius is calculated",
  massEarth: "Mass (Earth masses)",
  massCalculated: "Mass is calculated",
  massIsMinimum: "Mass is a minimum mass",
  density: "Density (g/cm³)",
  densityCalculated: "Density is calculated",
  eqTempK: "Equilibrium temperature (K)",
  eqTempCalculated: "Equilibrium temperature is calculated",
  insolation: "Insolation (Earth = 1)",
  insolationCalculated: "Insolation is calculated",
};

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}
