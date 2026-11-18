import { planetAppearance } from "@/app/planets/appearance";
import type { ClimateClass, PlanetClass } from "@/app/planets/classify";
import type { GlobeSpec } from "@/app/planets/globe/spec";
import { describePlanet } from "@/app/planets/labels";
import { AU_KM, bodyAppearance, DWARF_PLANETS, moonsOf, radiusEarth, type SolarBody } from "@/app/solar-system/bodies";

/**
 * One star on the map, kept as a compact tuple because the browser loads all of
 * them at once. Positions are in parsecs and the temperature is in kelvin.
 */
export type MapStar = [
  slug: string,
  name: string,
  x: number,
  y: number,
  z: number,
  teffK: number | null,
  planetCount: number,
];

/** The response body of GET /map/stars. */
export interface MapStarsPayload {
  stars: MapStar[];
}

/** The response body of GET /map/systems/[slug]. */
export interface MapSystemPayload {
  star: {
    slug: string;
    name: string;
    isSun: boolean;
    teffK: number | null;
    radiusSun: number | null;
    massSun: number | null;
    distPc: number | null;
  };
  planets: MapPlanet[];
}

export interface MapPlanet {
  slug: string;
  name: string;
  /** A short label such as "Super-Earth, temperate". */
  description: string;
  /** The page of the planet or dwarf planet. */
  href: string;
  orbitalPeriodDays: number | null;
  semiMajorAxisAu: number | null;
  eccentricity: number | null;
  radiusEarth: number | null;
  /** The same appearance as on the planet's own page. */
  globe: GlobeSpec;
  /** The moons with a page of their own, from the inside out. Only bodies of the solar system have them. */
  moons: MapMoon[];
}

export interface MapMoon {
  slug: string;
  name: string;
  href: string;
  semiMajorAxisKm: number;
  orbitalPeriodDays: number;
  eccentricity: number;
  /** Above 90 degrees the moon orbits backwards. */
  inclinationDeg: number;
  /** Whether the inclination is measured against the ecliptic instead of the planet's equator. */
  ecliptic: boolean;
  radiusKm: number;
  globe: GlobeSpec;
}

export interface StarRow {
  slug: string;
  name: string;
  x: number;
  y: number;
  z: number;
  teffK: number | null;
  planetCount: number;
}

export interface SystemStarRow {
  slug: string;
  name: string;
  source: "nasa" | "sol";
  teffK: number | null;
  radiusSun: number | null;
  massSun: number | null;
  distPc: number | null;
}

export interface SystemPlanetRow {
  slug: string;
  name: string;
  source: "nasa" | "sol";
  planetClass: PlanetClass | null;
  climateClass: ClimateClass | null;
  orbitalPeriodDays: number | null;
  semiMajorAxisAu: number | null;
  eccentricity: number | null;
  radiusEarth: number | null;
  eqTempK: number | null;
  densityEarth: number | null;
}

/** Three decimals (a thousandth of a parsec) are far finer than the measurements and keep the payload small. */
const round = (value: number) => Math.round(value * 1000) / 1000;

export function toMapStar(row: StarRow): MapStar {
  return [
    row.slug,
    row.name,
    round(row.x),
    round(row.y),
    round(row.z),
    row.teffK === null ? null : Math.round(row.teffK),
    row.planetCount,
  ];
}

export function toMapSystem(star: SystemStarRow, planets: SystemPlanetRow[]): MapSystemPayload {
  const isSun = star.source === "sol";
  const listed: MapPlanet[] = planets.map((planet) => ({
    slug: planet.slug,
    name: planet.name,
    description: describePlanet(planet.planetClass, planet.climateClass),
    href: `/planets/${planet.slug}`,
    orbitalPeriodDays: planet.orbitalPeriodDays,
    semiMajorAxisAu: planet.semiMajorAxisAu,
    eccentricity: planet.eccentricity,
    radiusEarth: planet.radiusEarth,
    globe: planetAppearance({
      slug: planet.slug,
      source: planet.source,
      planetClass: planet.planetClass,
      climateClass: planet.climateClass,
      starTeffK: star.teffK,
      radiusEarth: planet.radiusEarth,
      eqTempK: planet.eqTempK,
      densityEarth: planet.densityEarth,
      orbitalPeriodDays: planet.orbitalPeriodDays,
    }).globe,
    moons: planet.source === "sol" ? moonsOf(planet.slug).map(toMapMoon) : [],
  }));
  // The dwarf planets join the planets in the order of their orbits.
  const dwarfs: MapPlanet[] = isSun
    ? DWARF_PLANETS.map((body) => ({
        slug: body.slug,
        name: body.name,
        description: "Dwarf planet",
        href: `/solar-system/${body.slug}`,
        orbitalPeriodDays: body.orbitalPeriodDays,
        semiMajorAxisAu: body.semiMajorAxisKm / AU_KM,
        eccentricity: body.eccentricity,
        radiusEarth: radiusEarth(body),
        globe: bodyAppearance(body).globe,
        moons: moonsOf(body.slug).map(toMapMoon),
      }))
    : [];
  return {
    star: {
      slug: star.slug,
      name: star.name,
      isSun,
      teffK: star.teffK,
      radiusSun: star.radiusSun,
      massSun: star.massSun,
      distPc: star.distPc,
    },
    planets: dwarfs.length > 0 ? [...listed, ...dwarfs].sort(byPeriod) : listed,
  };
}

function byPeriod(a: MapPlanet, b: MapPlanet): number {
  return (a.orbitalPeriodDays ?? Infinity) - (b.orbitalPeriodDays ?? Infinity);
}

function toMapMoon(body: SolarBody): MapMoon {
  return {
    slug: body.slug,
    name: body.name,
    href: `/solar-system/${body.slug}`,
    semiMajorAxisKm: body.semiMajorAxisKm,
    orbitalPeriodDays: body.orbitalPeriodDays,
    eccentricity: body.eccentricity,
    inclinationDeg: body.inclinationDeg,
    ecliptic: body.ecliptic === true,
    radiusKm: body.radiusKm,
    globe: bodyAppearance(body).globe,
  };
}
