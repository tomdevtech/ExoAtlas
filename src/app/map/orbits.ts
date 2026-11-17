/**
 * Lays out orbits for the system view. Real proportions are unreadable (Neptune is
 * 80 times as far out as Mercury), so the order, shape and relative speed of the
 * orbits are kept while distances are compressed and planets are enlarged.
 */

export interface OrbitInput {
  orbitalPeriodDays: number | null;
  semiMajorAxisAu: number | null;
  eccentricity: number | null;
  radiusEarth: number | null;
}

export interface OrbitLayout {
  /** The index of the planet in the input. */
  index: number;
  /** The semi-major axis in view units. */
  semiMajor: number;
  eccentricity: number;
  /** The angle of the point closest to the star, in radians. */
  periapsis: number;
  /** The seconds one orbit takes in the view. */
  period: number;
  /** The starting mean anomaly, from 0 to 2π. */
  phase: number;
  /** The planet radius in view units. */
  size: number;
}

/**
 * Returns the star radius in view units, where the Sun is 1. Size differences are
 * compressed and clamped so that giants and dwarfs both stay readable.
 */
export function starSize(radiusSun: number | null): number {
  return Math.min(Math.max((radiusSun ?? 1) ** 0.3, 0.55), 2.2);
}

/**
 * Returns the planet radius in view units, where Earth is 0.12. A missing radius is
 * treated as two Earth radii, and the result is clamped to stay visible but not huge.
 */
export function planetSize(radiusEarth: number | null): number {
  return Math.min(Math.max(0.12 * (radiusEarth ?? 2) ** 0.45, 0.07), 0.5);
}

/** Returns the semi-major axis in AU for a period in days around a star of `massSun` solar masses (Kepler's third law). */
export function axisFromPeriod(periodDays: number, massSun: number): number {
  return Math.cbrt(massSun * (periodDays / 365.25) ** 2);
}

/** Returns the period in days for a semi-major axis in AU (Kepler's third law). */
export function periodFromAxis(axisAu: number, massSun: number): number {
  return 365.25 * Math.sqrt(axisAu ** 3 / massSun);
}

/** Solves Kepler's equation M = E − e·sin E for the eccentric anomaly E with Newton's method. */
export function solveKepler(meanAnomaly: number, eccentricity: number): number {
  // For high eccentricities, starting at π keeps Newton's method from diverging.
  let E = eccentricity < 0.8 ? meanAnomaly : Math.PI;
  for (let i = 0; i < 12; i++) {
    const step = (E - eccentricity * Math.sin(E) - meanAnomaly) / (1 - eccentricity * Math.cos(E));
    E -= step;
    if (Math.abs(step) < 1e-9) break;
  }
  return E;
}

/** Returns the position in the orbital plane with the star at the origin; a `meanAnomaly` of 0 is the periapsis. */
export function orbitPoint(
  semiMajor: number,
  eccentricity: number,
  periapsis: number,
  meanAnomaly: number,
): [number, number] {
  const E = solveKepler(meanAnomaly % (2 * Math.PI), eccentricity);
  const x = semiMajor * (Math.cos(E) - eccentricity);
  const y = semiMajor * Math.sqrt(1 - eccentricity * eccentricity) * Math.sin(E);
  const cos = Math.cos(periapsis);
  const sin = Math.sin(periapsis);
  return [x * cos - y * sin, x * sin + y * cos];
}

/** Hashes two integers to a number in [0, 1) that is always the same for the same inputs. */
function scatter(seed: number, salt: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/**
 * Lays out a system's orbits, sorted from the inside out. A missing axis or period
 * is derived from the other, and planets with neither are placed outermost. The
 * `seed` keeps periapses and phases the same on every visit.
 */
export function layoutOrbits(
  planets: OrbitInput[],
  star: { massSun: number | null; radiusSun: number | null },
  seed = 1,
): OrbitLayout[] {
  const mass = star.massSun && star.massSun > 0 ? star.massSun : 1;

  const known = planets.map((planet, index) => {
    const period = positive(planet.orbitalPeriodDays);
    const axis = positive(planet.semiMajorAxisAu) ?? (period ? axisFromPeriod(period, mass) : null);
    return { planet, index, axis, period: period ?? (axis ? periodFromAxis(axis, mass) : null) };
  });

  // Planets without any orbit data are placed beyond the outermost known one.
  let outermost = Math.max(0, ...known.map((entry) => entry.axis ?? 0));
  const placed = known
    .map((entry) => {
      if (entry.axis !== null && entry.period !== null) {
        return { ...entry, axis: entry.axis, period: entry.period };
      }
      outermost = outermost > 0 ? outermost * 1.6 : 1;
      return { ...entry, axis: outermost, period: periodFromAxis(outermost, mass) };
    })
    .sort((a, b) => a.axis - b.axis);

  const layouts: OrbitLayout[] = [];
  let previousAxis = 0;
  let previousRadius = 0;
  let previousSize = 0;

  for (const entry of placed) {
    const size = planetSize(entry.planet.radiusEarth);
    // Eccentricity is capped so that extreme orbits do not stretch the whole layout.
    const eccentricity = Math.min(Math.max(entry.planet.eccentricity ?? 0, 0), 0.75);
    let semiMajor: number;
    if (layouts.length === 0) {
      // The innermost orbit's closest point must stay clear of the star.
      semiMajor = (starSize(star.radiusSun) + 0.7 + size) / (1 - eccentricity);
    } else {
      // Each doubling of the real distance adds one fixed step, so spacing is
      // logarithmic. Steps are at least wide enough to avoid overlap and at most 4 units.
      const wanted = 1.6 * Math.log2(entry.axis / previousAxis);
      const smallest = previousSize + size + 0.3;
      semiMajor = previousRadius + Math.min(Math.max(wanted, smallest), 4);
    }
    layouts.push({
      index: entry.index,
      semiMajor,
      eccentricity,
      periapsis: scatter(seed, entry.index * 2) * 2 * Math.PI,
      period: Math.min(Math.max(6 * (entry.period / 10) ** 0.4, 3), 240),
      phase: scatter(seed, entry.index * 2 + 1) * 2 * Math.PI,
      size,
    });
    previousAxis = entry.axis;
    previousRadius = semiMajor;
    previousSize = size;
  }
  return layouts;
}

function positive(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value > 0 ? value : null;
}
