/**
 * Our solar system: the Sun and its eight planets.
 *
 * Values: NASA Planetary Fact Sheet, https://nssdc.gsfc.nasa.gov/planetary/factsheet/
 * Radius and mass relative to Earth, distance in astronomical units. The
 * equilibrium temperature is the black-body temperature from the fact sheet of
 * each planet.
 */

export const SUN = {
  slug: "sun",
  name: "Sun",
  distPc: 0,
  x: 0,
  y: 0,
  z: 0,
  spectralType: "G2 V",
  teffK: 5772,
  radiusSun: 1,
  massSun: 1,
  vmag: -26.74,
};

export interface SolarSystemPlanet {
  name: string;
  slug: string;
  radiusEarth: number;
  massEarth: number;
  /** g/cm³ */
  density: number;
  semiMajorAxisAu: number;
  orbitalPeriodDays: number;
  eccentricity: number;
  eqTempK: number;
  /** Only for the planets that were discovered with a telescope. */
  discoveryYear: number | null;
}

// prettier-ignore
export const SOLAR_SYSTEM_PLANETS: SolarSystemPlanet[] = [
  { name: "Mercury", slug: "mercury", radiusEarth: 0.383, massEarth: 0.0553, density: 5.429, semiMajorAxisAu: 0.387, orbitalPeriodDays: 88.0,  eccentricity: 0.206, eqTempK: 439.6, discoveryYear: null },
  { name: "Venus",   slug: "venus",   radiusEarth: 0.949, massEarth: 0.815,  density: 5.243, semiMajorAxisAu: 0.723, orbitalPeriodDays: 224.7, eccentricity: 0.007, eqTempK: 226.6, discoveryYear: null },
  { name: "Earth",   slug: "earth",   radiusEarth: 1,     massEarth: 1,      density: 5.514, semiMajorAxisAu: 1,     orbitalPeriodDays: 365.2, eccentricity: 0.017, eqTempK: 254.0, discoveryYear: null },
  { name: "Mars",    slug: "mars",    radiusEarth: 0.532, massEarth: 0.107,  density: 3.934, semiMajorAxisAu: 1.52,  orbitalPeriodDays: 687.0, eccentricity: 0.094, eqTempK: 209.8, discoveryYear: null },
  { name: "Jupiter", slug: "jupiter", radiusEarth: 11.21, massEarth: 317.8,  density: 1.326, semiMajorAxisAu: 5.2,   orbitalPeriodDays: 4331,  eccentricity: 0.049, eqTempK: 109.9, discoveryYear: null },
  { name: "Saturn",  slug: "saturn",  radiusEarth: 9.45,  massEarth: 95.2,   density: 0.687, semiMajorAxisAu: 9.57,  orbitalPeriodDays: 10747, eccentricity: 0.052, eqTempK: 81.0,  discoveryYear: null },
  { name: "Uranus",  slug: "uranus",  radiusEarth: 4.01,  massEarth: 14.5,   density: 1.27,  semiMajorAxisAu: 19.17, orbitalPeriodDays: 30589, eccentricity: 0.047, eqTempK: 58.1,  discoveryYear: 1781 },
  { name: "Neptune", slug: "neptune", radiusEarth: 3.88,  massEarth: 17.1,   density: 1.638, semiMajorAxisAu: 30.18, orbitalPeriodDays: 59800, eccentricity: 0.01,  eqTempK: 46.6,  discoveryYear: 1846 },
];
