/**
 * Orbits for the system view of the map.
 *
 * Real proportions cannot be shown: Neptune is 80 times as far from the Sun as
 * Mercury, and next to their orbits all planets are dust. The view therefore
 * keeps the order, the shape and the relative speed of the orbits, but
 * squeezes the distances and enlarges the planets.
 */

export interface OrbitInput {
  orbitalPeriodDays: number | null;
  semiMajorAxisAu: number | null;
  eccentricity: number | null;
  radiusEarth: number | null;
}

export interface OrbitLayout {
  /** Index of the planet in the input. */
  index: number;
  /** Half of the longest diameter of the ellipse, in units of the view. */
  semiMajor: number;
  eccentricity: number;
  /** Direction of the point closest to the star, as an angle in the plane. */
  periapsis: number;
  /** Seconds one lap takes in the view. */
  period: number;
  /** Where on the orbit the planet starts, 0 to 2π. */
  phase: number;
  /** Radius of the planet in units of the view. */
  size: number;
}

/** Radius of a star in units of the view. The Sun is 1; giants and dwarfs differ less than in reality. */
export function starSize(radiusSun: number | null): number {
  return Math.min(Math.max((radiusSun ?? 1) ** 0.3, 0.55), 2.2);
}

/** Radius of a planet in units of the view. Earth is 0.12, Jupiter about three times that. */
export function planetSize(radiusEarth: number | null): number {
  return Math.min(Math.max(0.12 * (radiusEarth ?? 2) ** 0.45, 0.07), 0.5);
}

/**
 * Kepler's third law: the distance from the star in astronomical units that
 * belongs to a period in days, for a star of `massSun` solar masses.
 */
export function axisFromPeriod(periodDays: number, massSun: number): number {
  return Math.cbrt(massSun * (periodDays / 365.25) ** 2);
}

/** The other way round: the period in days for a distance in astronomical units. */
export function periodFromAxis(axisAu: number, massSun: number): number {
  return 365.25 * Math.sqrt(axisAu ** 3 / massSun);
}

/**
 * Solves Kepler's equation M = E − e·sin E for E. `meanAnomaly` grows evenly
 * with time; the result says where on the ellipse the planet is.
 */
export function solveKepler(meanAnomaly: number, eccentricity: number): number {
  let E = eccentricity < 0.8 ? meanAnomaly : Math.PI;
  for (let i = 0; i < 12; i++) {
    const step = (E - eccentricity * Math.sin(E) - meanAnomaly) / (1 - eccentricity * Math.cos(E));
    E -= step;
    if (Math.abs(step) < 1e-9) break;
  }
  return E;
}

/**
 * Position on an orbit in its plane, with the star at the origin (one focus of
 * the ellipse). `meanAnomaly` 0 is the point closest to the star.
 */
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

/** A number from 0 to 1 that is always the same for the same two inputs. */
function scatter(seed: number, salt: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/**
 * Lays out the orbits of a system for the view.
 *
 * The result is sorted from the inside out. Missing distances are derived
 * from the period and the other way round; a planet with neither goes to the
 * outside. `seed` fixes the starting points, so a system looks the same on
 * every visit.
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

  // Planets without any orbit data line up behind the outermost known one.
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
    const eccentricity = Math.min(Math.max(entry.planet.eccentricity ?? 0, 0), 0.75);
    let semiMajor: number;
    if (layouts.length === 0) {
      // The closest point of the innermost orbit stays clear of the star.
      semiMajor = (starSize(star.radiusSun) + 0.7 + size) / (1 - eccentricity);
    } else {
      // Twice the distance is one step further out; steps are neither tiny nor huge.
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
