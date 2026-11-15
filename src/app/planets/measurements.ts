import { createHash } from "node:crypto";
import { classifyClimate, classifyPlanet } from "./classify";

/** The values of a planet whose changes are recorded in the change history. */
export interface PlanetData {
  discoveryMethod: string | null;
  discoveryYear: number | null;
  discoveryFacility: string | null;
  orbitalPeriodDays: number | null;
  semiMajorAxisAu: number | null;
  eccentricity: number | null;
  radiusEarth: number | null;
  radiusCalculated: boolean;
  massEarth: number | null;
  massCalculated: boolean;
  massIsMinimum: boolean;
  density: number | null;
  densityCalculated: boolean;
  eqTempK: number | null;
  eqTempCalculated: boolean;
  insolation: number | null;
  insolationCalculated: boolean;
}

export const TRACKED_FIELDS = [
  "discoveryMethod",
  "discoveryYear",
  "discoveryFacility",
  "orbitalPeriodDays",
  "semiMajorAxisAu",
  "eccentricity",
  "radiusEarth",
  "radiusCalculated",
  "massEarth",
  "massCalculated",
  "massIsMinimum",
  "density",
  "densityCalculated",
  "eqTempK",
  "eqTempCalculated",
  "insolation",
  "insolationCalculated",
] as const satisfies readonly (keyof PlanetData)[];

/** Hash of the tracked values. Equal values always give the same hash. */
export function hashPlanet(data: PlanetData): string {
  const values = TRACKED_FIELDS.map((field) => data[field]);
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}

/** Adds planet class, climate class and hash to the measured values. */
export function withDerived<T extends PlanetData>(data: T) {
  return {
    ...data,
    planetClass: classifyPlanet(data.radiusEarth, data.massEarth),
    climateClass: classifyClimate(data.eqTempK),
    dataHash: hashPlanet(data),
  };
}
