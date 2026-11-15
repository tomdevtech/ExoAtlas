/**
 * A model of the Milky Way as a cloud of light points.
 *
 * Nobody has a photograph of our galaxy from outside, so the view from far
 * away is computed from what is known about its shape: a bar and a bulge in
 * the middle, a flat disc that thins out towards the edge, and four spiral
 * arms. Each point stands for many millions of stars.
 *
 * Coordinates as in the database: parsecs, the Sun at the origin, x towards
 * the galactic centre, y in the direction the galaxy turns, z to the north.
 */

/** The Sun is about 8,200 parsecs from the centre. */
export const GALACTIC_CENTRE: readonly [number, number, number] = [8200, 0, 0];

/** The bar is turned by about 25 degrees against the line from the Sun to the centre. */
const BAR_ANGLE = (-25 * Math.PI) / 180;
/** How tightly the arms are wound: the angle between an arm and a circle. */
const ARM_PITCH = (12.8 * Math.PI) / 180;
const ARM_COUNT = 4;
/** Radius at which the arms leave the ends of the bar. */
const ARM_START = 3200;
const DISC_EDGE = 17000;

export interface GalaxyModel {
  count: number;
  /** x, y, z per point in parsecs. */
  positions: Float32Array;
  /** Red, green and blue per point, 0 to 1. */
  colors: Float32Array;
  /** Diameter per point in parsecs. */
  sizes: Float32Array;
  /** Brightness per point, 0 to 1. */
  alphas: Float32Array;
}

/** A random number generator that returns the same numbers for the same seed. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Angle of the centre line of an arm at the distance `radius` from the centre. */
export function armAngle(arm: number, radius: number): number {
  return (arm * 2 * Math.PI) / ARM_COUNT + BAR_ANGLE + Math.log(radius / ARM_START) / Math.tan(ARM_PITCH);
}

type Rgb = [number, number, number];

const OLD_STARS: Rgb = [1.0, 0.82, 0.58];
const DISC_STARS: Rgb = [1.0, 0.91, 0.78];
const YOUNG_STARS: Rgb = [0.68, 0.8, 1.0];
const GAS_CLOUDS: Rgb = [1.0, 0.42, 0.56];

/**
 * Builds the model. `count` is the number of points; the same seed always
 * gives the same galaxy.
 */
export function buildGalaxy(count: number, seed = 7): GalaxyModel {
  const random = mulberry32(seed);
  // Two uniform numbers make one that follows the bell curve.
  const gauss = () => {
    const u = Math.max(random(), 1e-9);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
  };

  const model: GalaxyModel = {
    count,
    positions: new Float32Array(count * 3),
    colors: new Float32Array(count * 3),
    sizes: new Float32Array(count),
    alphas: new Float32Array(count),
  };

  let index = 0;
  const add = (gx: number, gy: number, z: number, color: Rgb, size: number, alpha: number) => {
    // From coordinates around the galactic centre to coordinates around the Sun.
    model.positions[index * 3] = gx + GALACTIC_CENTRE[0];
    model.positions[index * 3 + 1] = gy + GALACTIC_CENTRE[1];
    model.positions[index * 3 + 2] = z + GALACTIC_CENTRE[2];
    const shade = 0.85 + 0.3 * random();
    model.colors[index * 3] = Math.min(color[0] * shade, 1);
    model.colors[index * 3 + 1] = Math.min(color[1] * shade, 1);
    model.colors[index * 3 + 2] = Math.min(color[2] * shade, 1);
    model.sizes[index] = size;
    model.alphas[index] = alpha;
    index++;
  };

  const bulge = Math.floor(count * 0.14);
  const bar = Math.floor(count * 0.1);
  const disc = Math.floor(count * 0.3);
  const haze = Math.floor(count * 0.04);
  const arms = count - bulge - bar - disc - haze;

  // The bulge: a slightly flattened ball of old, yellowish stars.
  for (let i = 0; i < bulge; i++) {
    add(gauss() * 900, gauss() * 900, gauss() * 620, OLD_STARS, 240 + random() * 260, 0.16);
  }

  // The bar: the same kind of stars, stretched to a length of about 9,000 parsecs.
  const barCos = Math.cos(BAR_ANGLE);
  const barSin = Math.sin(BAR_ANGLE);
  for (let i = 0; i < bar; i++) {
    const along = gauss() * 1900;
    const across = gauss() * 620;
    add(
      along * barCos - across * barSin,
      along * barSin + across * barCos,
      gauss() * 380,
      OLD_STARS,
      240 + random() * 240,
      0.13,
    );
  }

  // The disc: most stars are near the centre, and almost all near the plane.
  const discRadius = () => {
    for (;;) {
      const radius = -2600 * Math.log(Math.max(random() * random(), 1e-12));
      if (radius < DISC_EDGE) return radius;
    }
  };
  for (let i = 0; i < disc; i++) {
    const radius = discRadius();
    const angle = random() * 2 * Math.PI;
    add(
      radius * Math.cos(angle),
      radius * Math.sin(angle),
      gauss() * 260,
      DISC_STARS,
      260 + random() * 340,
      0.07,
    );
  }

  // A faint glow that fills the gaps between the points.
  for (let i = 0; i < haze; i++) {
    const radius = discRadius();
    const angle = random() * 2 * Math.PI;
    add(
      radius * Math.cos(angle),
      radius * Math.sin(angle),
      gauss() * 320,
      DISC_STARS,
      1800 + random() * 1600,
      0.02,
    );
  }

  // The arms: young, blue stars and here and there a red cloud of glowing gas.
  const armRadius = () => {
    for (;;) {
      const radius = ARM_START - 3400 * Math.log(Math.max(random(), 1e-9));
      if (radius < DISC_EDGE) return radius;
    }
  };
  for (let i = 0; i < arms; i++) {
    const arm = Math.floor(random() * ARM_COUNT);
    const radius = armRadius();
    // Arms are narrow with a soft outer side; a few stars stray far.
    const spread = (random() < 0.18 ? 1100 : 380) * (0.7 + radius / 12000);
    const angle = armAngle(arm, radius) + (gauss() * spread) / radius;
    const along = radius + gauss() * 160;
    const cloud = random() < 0.035;
    add(
      along * Math.cos(angle),
      along * Math.sin(angle),
      gauss() * (cloud ? 60 : 130),
      cloud ? GAS_CLOUDS : YOUNG_STARS,
      cloud ? 300 + random() * 260 : 150 + random() * 260,
      cloud ? 0.2 : 0.085,
    );
  }

  return model;
}

/**
 * The colour of a star with the surface temperature `teffK` as red, green and
 * blue from 0 to 1: red dwarfs orange, stars like the Sun nearly white, hot
 * stars bluish. An approximation of the colour of a glowing body.
 */
export function starColor(teffK: number | null): Rgb {
  const t = Math.min(Math.max(teffK ?? 5600, 2000), 30000) / 100;
  const clamp = (value: number) => Math.min(Math.max(value / 255, 0), 1);
  const red = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const green =
    t <= 66
      ? 99.4708025861 * Math.log(t) - 161.1195681661
      : 288.1221695283 * (t - 60) ** -0.0755148492;
  const blue = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return [clamp(red), clamp(green), clamp(blue)];
}
