/**
 * The round moons of the solar system and the dwarf planets Ceres and Pluto.
 *
 * Moons: JPL Solar System Dynamics, planetary satellite physical parameters
 * (https://ssd.jpl.nasa.gov/sats/phys_par/) and mean orbital elements (https://ssd.jpl.nasa.gov/sats/elem/).
 * Ceres: JPL Small-Body Database. Pluto: NASA Pluto Fact Sheet for the orbit and JPL for the mass.
 * Charon's density is the New Horizons value (Nimmo et al. 2017); JPL's table lists 1.853 g/cm³, which does
 * not fit its own mass and the measured radius of 606 km.
 *
 * These bodies never change through the NASA sync, so they live in code rather than in the database.
 */
import { planetAppearance, type Appearance } from "@/app/planets/appearance";
import { SOLAR_SYSTEM_PLANETS } from "./data";

export interface SolarBody {
  slug: string;
  name: string;
  kind: "moon" | "dwarf_planet";
  /** The slug of the planet or dwarf planet the moon orbits, or "sun". */
  parent: string;
  /** Mean radius in km. */
  radiusKm: number;
  /** Gravitational parameter G·M in km³/s², which is measured far more precisely than the mass itself. */
  gm: number;
  /** Mean density in g/cm³. */
  density: number;
  semiMajorAxisKm: number;
  orbitalPeriodDays: number;
  eccentricity: number;
  /**
   * Inclination in degrees against the plane the orbit precesses about: for most moons close to the planet's
   * equator, for the Moon and the dwarf planets the ecliptic (see `ecliptic`). Above 90 the orbit is retrograde.
   */
  inclinationDeg: number;
  /** True for a moon whose orbit is measured against the ecliptic rather than its planet's equator. */
  ecliptic?: true;
  /** Null when the body has been known since antiquity. */
  discoveryYear: number | null;
  discoverer: string | null;
  summary: string;
}

/** G·M of Earth in km³/s², to express masses relative to Earth. */
const EARTH_GM = 398600.4418;
/** Earth's mean radius in km, the unit the planet data uses. */
export const EARTH_RADIUS_KM = 6371.0;
export const AU_KM = 149597870.7;

const au = (value: number) => value * AU_KM;

// prettier-ignore
export const SOLAR_BODIES: SolarBody[] = [
  { slug: "moon", name: "Moon", kind: "moon", parent: "earth", radiusKm: 1737.4, gm: 4902.8, density: 3.344, semiMajorAxisKm: 384400, orbitalPeriodDays: 27.322, eccentricity: 0.0554, inclinationDeg: 5.16, ecliptic: true, discoveryYear: null, discoverer: null,
    summary: "Earth's only natural satellite. The dark plains are ancient lava floods; the bright highlands are older crust, battered by impacts." },

  { slug: "io", name: "Io", kind: "moon", parent: "jupiter", radiusKm: 1821.49, gm: 5959.91547, density: 3.5276, semiMajorAxisKm: 421800, orbitalPeriodDays: 1.762732, eccentricity: 0.004, inclinationDeg: 0, discoveryYear: 1610, discoverer: "Galileo Galilei",
    summary: "The most volcanically active body known. Jupiter's tides knead its interior, feeding hundreds of volcanoes whose sulphur paints the surface yellow, orange and white." },
  { slug: "europa", name: "Europa", kind: "moon", parent: "jupiter", radiusKm: 1560.8, gm: 3202.7121, density: 3.013, semiMajorAxisKm: 671100, orbitalPeriodDays: 3.525463, eccentricity: 0.009, inclinationDeg: 0.5, discoveryYear: 1610, discoverer: "Galileo Galilei",
    summary: "A shell of ice, criss-crossed by long cracks, covers a salty ocean. It is one of the most promising places in the solar system to look for life." },
  { slug: "ganymede", name: "Ganymede", kind: "moon", parent: "jupiter", radiusKm: 2631.2, gm: 9887.83275, density: 1.9416, semiMajorAxisKm: 1070400, orbitalPeriodDays: 7.155588, eccentricity: 0.001, inclinationDeg: 0.2, discoveryYear: 1610, discoverer: "Galileo Galilei",
    summary: "The largest moon in the solar system, wider than Mercury, and the only one with a magnetic field of its own. Dark, old terrain alternates with younger, grooved ice." },
  { slug: "callisto", name: "Callisto", kind: "moon", parent: "jupiter", radiusKm: 2410.3, gm: 7179.2834, density: 1.834, semiMajorAxisKm: 1882700, orbitalPeriodDays: 16.69044, eccentricity: 0.007, inclinationDeg: 0.3, discoveryYear: 1610, discoverer: "Galileo Galilei",
    summary: "One of the most heavily cratered surfaces known. Its dark, icy crust has hardly changed in four billion years." },

  { slug: "mimas", name: "Mimas", kind: "moon", parent: "saturn", radiusKm: 198.2, gm: 2.50349, density: 1.1501, semiMajorAxisKm: 186000, orbitalPeriodDays: 0.942422, eccentricity: 0.02, inclinationDeg: 1.6, discoveryYear: 1789, discoverer: "William Herschel",
    summary: "The crater Herschel spans a third of its width and makes the small moon look like a staring eye." },
  { slug: "enceladus", name: "Enceladus", kind: "moon", parent: "saturn", radiusKm: 252.1, gm: 7.21037, density: 1.6097, semiMajorAxisKm: 238400, orbitalPeriodDays: 1.370218, eccentricity: 0.005, inclinationDeg: 0, discoveryYear: 1789, discoverer: "William Herschel",
    summary: "Geysers at its south pole spray water from an ocean under the ice into space and feed Saturn's E ring. Its fresh ice reflects almost all the sunlight." },
  { slug: "tethys", name: "Tethys", kind: "moon", parent: "saturn", radiusKm: 531.1, gm: 41.21353, density: 0.984, semiMajorAxisKm: 295000, orbitalPeriodDays: 1.887802, eccentricity: 0.001, inclinationDeg: 1.1, discoveryYear: 1684, discoverer: "Giovanni Domenico Cassini",
    summary: "Made almost entirely of water ice. The huge crater Odysseus and the canyon Ithaca Chasma, which runs across three quarters of its circumference, scar the surface." },
  { slug: "dione", name: "Dione", kind: "moon", parent: "saturn", radiusKm: 561.4, gm: 73.11607, density: 1.4781, semiMajorAxisKm: 377700, orbitalPeriodDays: 2.736916, eccentricity: 0.002, inclinationDeg: 0, discoveryYear: 1684, discoverer: "Giovanni Domenico Cassini",
    summary: "Bright ice cliffs, hundreds of metres high, streak its trailing side; the side that leads along the orbit is covered in craters." },
  { slug: "rhea", name: "Rhea", kind: "moon", parent: "saturn", radiusKm: 763.5, gm: 153.94175, density: 1.2372, semiMajorAxisKm: 527200, orbitalPeriodDays: 4.517503, eccentricity: 0.001, inclinationDeg: 0.3, discoveryYear: 1672, discoverer: "Giovanni Domenico Cassini",
    summary: "Saturn's second-largest moon: a cold, heavily cratered ball of ice and some rock." },
  { slug: "titan", name: "Titan", kind: "moon", parent: "saturn", radiusKm: 2574.76, gm: 8978.1371, density: 1.8814, semiMajorAxisKm: 1221900, orbitalPeriodDays: 15.945448, eccentricity: 0.029, inclinationDeg: 0.3, discoveryYear: 1655, discoverer: "Christiaan Huygens",
    summary: "The only moon with a thick atmosphere, denser than Earth's. Below the orange haze, rivers, lakes and seas of liquid methane and ethane shape the land." },
  { slug: "iapetus", name: "Iapetus", kind: "moon", parent: "saturn", radiusKm: 734.3, gm: 120.51511, density: 1.0887, semiMajorAxisKm: 3561700, orbitalPeriodDays: 79.331002, eccentricity: 0.028, inclinationDeg: 7.6, discoveryYear: 1671, discoverer: "Giovanni Domenico Cassini",
    summary: "One side is as dark as coal and the other as bright as snow, and a ridge up to 20 km high runs along much of its equator." },

  { slug: "miranda", name: "Miranda", kind: "moon", parent: "uranus", radiusKm: 235.8, gm: 4.3, density: 1.178, semiMajorAxisKm: 129846, orbitalPeriodDays: 1.413479, eccentricity: 0.001, inclinationDeg: 4.4, discoveryYear: 1948, discoverer: "Gerard Kuiper",
    summary: "A patchwork of grooved terrain and cliffs that drop about 20 km. The small moon must have been torn up and reshaped in its past." },
  { slug: "ariel", name: "Ariel", kind: "moon", parent: "uranus", radiusKm: 578.9, gm: 83.5, density: 1.539, semiMajorAxisKm: 190929, orbitalPeriodDays: 2.520379, eccentricity: 0.001, inclinationDeg: 0, discoveryYear: 1851, discoverer: "William Lassell",
    summary: "The brightest of Uranus' large moons, with a young surface cut by long fault valleys." },
  { slug: "umbriel", name: "Umbriel", kind: "moon", parent: "uranus", radiusKm: 584.7, gm: 85.1, density: 1.523, semiMajorAxisKm: 265986, orbitalPeriodDays: 4.144177, eccentricity: 0.004, inclinationDeg: 0.1, discoveryYear: 1851, discoverer: "William Lassell",
    summary: "The darkest of Uranus' large moons: old and heavily cratered, apart from a puzzling bright ring, the crater Wunda, near its equator." },
  { slug: "titania", name: "Titania", kind: "moon", parent: "uranus", radiusKm: 788.9, gm: 226.9, density: 1.653, semiMajorAxisKm: 436298, orbitalPeriodDays: 8.705869, eccentricity: 0.002, inclinationDeg: 0.1, discoveryYear: 1787, discoverer: "William Herschel",
    summary: "Uranus' largest moon. Huge canyons split its icy crust, which probably cracked when the interior froze and expanded." },
  { slug: "oberon", name: "Oberon", kind: "moon", parent: "uranus", radiusKm: 761.4, gm: 205.3, density: 1.664, semiMajorAxisKm: 583511, orbitalPeriodDays: 13.463237, eccentricity: 0.002, inclinationDeg: 0.1, discoveryYear: 1787, discoverer: "William Herschel",
    summary: "The outermost large moon of Uranus: old and cratered, with dark material on the floors of many craters." },

  { slug: "triton", name: "Triton", kind: "moon", parent: "neptune", radiusKm: 1352.6, gm: 1428.49546, density: 2.0649, semiMajorAxisKm: 354800, orbitalPeriodDays: 5.8792, eccentricity: 0, inclinationDeg: 157.3, discoveryYear: 1846, discoverer: "William Lassell",
    summary: "It orbits Neptune backwards, so it was probably captured from the Kuiper belt. Geysers of nitrogen rise from its frozen surface." },

  { slug: "ceres", name: "Ceres", kind: "dwarf_planet", parent: "sun", radiusKm: 469.7, gm: 62.6284, density: 2.162, semiMajorAxisKm: au(2.77), orbitalPeriodDays: 1680, eccentricity: 0.0797, inclinationDeg: 10.6, discoveryYear: 1801, discoverer: "Giuseppe Piazzi",
    summary: "The largest object in the asteroid belt and the only dwarf planet in the inner solar system. Bright salt deposits shine on the floor of the crater Occator." },
  { slug: "pluto", name: "Pluto", kind: "dwarf_planet", parent: "sun", radiusKm: 1188.3, gm: 869.6, density: 1.854, semiMajorAxisKm: au(39.48), orbitalPeriodDays: 90560, eccentricity: 0.2488, inclinationDeg: 17.16, discoveryYear: 1930, discoverer: "Clyde Tombaugh",
    summary: "The best-known dwarf planet of the Kuiper belt. A vast plain of nitrogen ice, Sputnik Planitia, forms the bright heart on its face." },
  { slug: "charon", name: "Charon", kind: "moon", parent: "pluto", radiusKm: 606, gm: 106.1, density: 1.702, semiMajorAxisKm: 19600, orbitalPeriodDays: 6.387222, eccentricity: 0, inclinationDeg: 0, discoveryYear: 1978, discoverer: "James Christy",
    summary: "Half as wide as Pluto, so the two circle a point between them. A reddish cap of material lost by Pluto's atmosphere covers its north pole." },
];

export function solarBody(slug: string): SolarBody | undefined {
  return SOLAR_BODIES.find((body) => body.slug === slug);
}

/** The moons of a planet or dwarf planet, from the inside out. */
export function moonsOf(parent: string): SolarBody[] {
  return SOLAR_BODIES.filter((body) => body.kind === "moon" && body.parent === parent).sort(
    (a, b) => a.semiMajorAxisKm - b.semiMajorAxisKm,
  );
}

export const DWARF_PLANETS = SOLAR_BODIES.filter((body) => body.kind === "dwarf_planet");

export function massEarth(body: SolarBody): number {
  return body.gm / EARTH_GM;
}

export function radiusEarth(body: SolarBody): number {
  return body.radiusKm / EARTH_RADIUS_KM;
}

/** Surface gravity in m/s², from G·M / r². */
export function surfaceGravity(body: SolarBody): number {
  return (body.gm / body.radiusKm ** 2) * 1000;
}

/** The look of a body: its real map, as for the planets of the solar system. */
export function bodyAppearance(body: SolarBody): Appearance {
  return planetAppearance({
    slug: body.slug,
    source: "sol",
    planetClass: null,
    climateClass: null,
    starTeffK: null,
    radiusEarth: radiusEarth(body),
    eqTempK: null,
    densityEarth: null,
    orbitalPeriodDays: body.orbitalPeriodDays,
  });
}

/** The name of what the body orbits: a planet, a dwarf planet or the Sun. */
export function parentName(body: SolarBody): string {
  if (body.parent === "sun") return "Sun";
  return (
    SOLAR_SYSTEM_PLANETS.find((planet) => planet.slug === body.parent)?.name ??
    solarBody(body.parent)?.name ??
    body.parent
  );
}

/** A short label such as "Moon of Jupiter" or "Dwarf planet". */
export function describeBody(body: SolarBody): string {
  return body.kind === "dwarf_planet" ? "Dwarf planet" : `Moon of ${parentName(body)}`;
}

/** The page of the body's parent: a planet page, a body page, or the Sun's star page. */
export function parentHref(body: SolarBody): string {
  if (body.parent === "sun") return "/stars/sun";
  return solarBody(body.parent) ? `/solar-system/${body.parent}` : `/planets/${body.parent}`;
}
