import {
  BULGE_HEIGHT,
  BULGE_WIDTH,
  GALACTIC_CENTRE,
  GALAXY_EDGE,
  GALAXY_PICTURE_WIDTH,
  starColor,
} from "./galaxy";

/**
 * The stars between the stars with planets.
 *
 * The Milky Way has some hundred billion stars; nobody can store them, let
 * alone draw them. Nor is that needed: from any one place only a few hundred
 * thousand are bright enough to make out, the nearest faint ones and the
 * rare brilliant ones far away. So space is divided into cubes (cells), and
 * a cell only makes its stars when the camera comes near enough to see them.
 * The stars of a cell come from its own coordinates, so a cell always holds
 * the same stars, wherever one flies and however often one comes back.
 *
 * The stars are sorted into classes by how much light they give. Each class
 * has its own size of cell and is only made out to the distance at which
 * stars of its brightness fade into the glow of the galaxy: red dwarfs a few
 * parsecs, stars like the Sun some dozens, giants hundreds, the rare
 * supergiants thousands. How many stars a cell holds follows the density of
 * the galaxy there: the plan of its arms from the artist's impression (see
 * galaxy.ts), a disc that thins out above and below its plane, and the
 * crowded bulge in the middle.
 *
 * Lengths are parsecs in the coordinates of the map (galaxy.ts).
 */

export interface StarClass {
  name: string;
  /** Light of the faintest and the brightest stars of the class, in suns. */
  light: [number, number];
  /** Surface temperatures in kelvin; `hot` stars are drawn from the second pair now and then. */
  teff: [number, number];
  hot?: { share: number; teff: [number, number] };
  /** Stars of this class per cubic parsec in the plane near the Sun. */
  density: number;
  /** The light thins out by e every so many parsecs above and below the plane. Young bright stars keep close to it. */
  height: number;
  /** How far from the camera its stars are made out, in parsecs. */
  reach: number;
  /**
   * Whether the photograph of the sky shows these stars near the Sun. There
   * the photograph is right and the computed stars would only add false
   * ones, so they appear as it fades. The faint classes it cannot show stay
   * dim there too, or they would lie over it like grain.
   */
  photographed: boolean;
}

/**
 * About one star in ten per cubic parsec near the Sun, most of them red
 * dwarfs. The reach grows with the square root of the light, so the faintest
 * star of every class is about equally bright where its class ends.
 */
export const STAR_CLASSES: readonly StarClass[] = [
  { name: "red dwarfs", light: [0.004, 0.08], teff: [2700, 3800], density: 0.075, height: 300, reach: 20, photographed: false },
  { name: "suns", light: [0.1, 1.6], teff: [4400, 6400], density: 0.02, height: 300, reach: 80, photographed: false },
  { name: "bright stars", light: [2, 40], teff: [6500, 10000], density: 0.0035, height: 150, reach: 220, photographed: true },
  {
    name: "giants",
    light: [40, 600],
    teff: [3600, 5000],
    hot: { share: 0.15, teff: [10000, 18000] },
    density: 0.00022,
    height: 280,
    reach: 650,
    photographed: true,
  },
  {
    name: "supergiants",
    light: [2000, 120000],
    teff: [3400, 4200],
    hot: { share: 0.65, teff: [15000, 32000] },
    density: 0.0000007,
    height: 90,
    reach: 4000,
    photographed: true,
  },
];

/** Cells per class are so big that its reach is three cells. */
export const CELLS_PER_REACH = 3;

/** At most this many stars of one class at once. Where the galaxy is crowded the reach shrinks instead. */
export const STARS_PER_CLASS = 50_000;

/** At most this many stars in one cell, whatever the density. */
const STARS_PER_CELL = 6000;

/** The size of a cell of the class, in parsecs. */
export function cellSize(starClass: StarClass): number {
  return starClass.reach / CELLS_PER_REACH;
}

// ---- The plan of the disc -----------------------------------------------------

/**
 * How crowded the plane of the galaxy is at (x, y), compared with the
 * neighbourhood of the Sun. Read from a brightness grid of the artist's
 * impression when there is one (see `planFromPicture`), else from a smooth
 * disc that thins out away from the centre.
 */
export type Plan = (x: number, y: number) => number;

/** A disc without arms: crowded in the middle, thinning out every 2,600 parsecs. */
export const SMOOTH_PLAN: Plan = (x, y) => {
  const fromCentre = Math.hypot(x - GALACTIC_CENTRE[0], y - GALACTIC_CENTRE[1]);
  if (fromCentre > GALAXY_EDGE) return 0;
  const disc = Math.exp(-(fromCentre - GALACTIC_CENTRE[0]) / 2600);
  const bulge = 6 * Math.exp(-((fromCentre / BULGE_WIDTH) ** 2));
  return disc + bulge;
};

/**
 * A plan from the brightness of the artist's impression, given as a square
 * grid of `size` × `size` values, row by row from the top (as a picture is
 * stored). Bright arms are crowded, the dark gaps between them thin. The
 * brightness at the Sun counts as 1, and the plan stays between a twentieth
 * of that and forty times it.
 */
export function planFromPicture(brightness: Float32Array, size: number): Plan {
  const at = (x: number, y: number) => {
    // Towards the centre is up in the picture, the longitude of 90 degrees left.
    const column = (0.5 - y / GALAXY_PICTURE_WIDTH) * size - 0.5;
    const row = (0.5 - (x - GALACTIC_CENTRE[0]) / GALAXY_PICTURE_WIDTH) * size - 0.5;
    if (column < 0 || row < 0 || column > size - 1 || row > size - 1) return 0;
    const c = Math.floor(column);
    const r = Math.floor(row);
    const fc = column - c;
    const fr = row - r;
    const c1 = Math.min(size - 1, c + 1);
    const r1 = Math.min(size - 1, r + 1);
    const top = brightness[r * size + c] * (1 - fc) + brightness[r * size + c1] * fc;
    const bottom = brightness[r1 * size + c] * (1 - fc) + brightness[r1 * size + c1] * fc;
    return top * (1 - fr) + bottom * fr;
  };
  // The Sun sits in a gap of the picture; its neighbourhood on a scale of a
  // few hundred parsecs is the fair comparison.
  let sun = 0;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) sun += at(dx * 300, dy * 300);
  sun = Math.max(sun / 9, 1e-4);
  return (x, y) => {
    const fromCentre = Math.hypot(x - GALACTIC_CENTRE[0], y - GALACTIC_CENTRE[1]);
    if (fromCentre > GALAXY_EDGE) return 0;
    return Math.min(40, Math.max(0.05, at(x, y) / sun));
  };
}

/** How far the stars of a class reach above and below the plane at a distance `fromCentre` from the centre: more in the bulge. */
function thickness(starClass: StarClass, fromCentre: number): number {
  return starClass.height + BULGE_HEIGHT * Math.exp(-((fromCentre / BULGE_WIDTH) ** 2));
}

/** Stars of the class per cubic parsec at a point. */
export function starDensity(starClass: StarClass, plan: Plan, x: number, y: number, z: number): number {
  const fromCentre = Math.hypot(x - GALACTIC_CENTRE[0], y - GALACTIC_CENTRE[1]);
  return starClass.density * plan(x, y) * Math.exp(-Math.abs(z) / thickness(starClass, fromCentre));
}

/**
 * How far the class is made out from a point. Where the galaxy is crowded,
 * so many stars of a class would be in reach that it is cut down, so that
 * the class keeps to its budget; the glow of the galaxy fills in beyond.
 */
export function reachAt(starClass: StarClass, plan: Plan, x: number, y: number, z: number): number {
  const reach = starClass.reach;
  // The stars in reach lie mostly in the plane below the camera.
  const fromCentre = Math.hypot(x - GALACTIC_CENTRE[0], y - GALACTIC_CENTRE[1]);
  const height = thickness(starClass, fromCentre);
  const above = Math.abs(z);
  if (above > reach + 4 * height) return reach;
  const depth = Math.min(2 * reach, 2 * height);
  const expected = starClass.density * plan(x, y) * Math.PI * reach * reach * depth * Math.exp(-above / height);
  if (expected <= STARS_PER_CLASS) return reach;
  return reach * Math.sqrt(STARS_PER_CLASS / expected);
}

// ---- Cells -----------------------------------------------------------------------

/** The stars of one cell: position, colour and light, seven numbers each. */
export interface CellStars {
  /** x, y, z, red, green, blue, light in suns; one star after the other. */
  data: Float32Array;
  count: number;
}

/** Numbers that tell a cell apart from all others: its class and where it is. */
export function cellKey(classIndex: number, ix: number, iy: number, iz: number): string {
  return `${classIndex}:${ix}:${iy}:${iz}`;
}

/** The cells of a class whose stars can be in reach of a point, nearest first. */
export function cellsAround(classIndex: number, reach: number, x: number, y: number, z: number): [number, number, number][] {
  const size = cellSize(STAR_CLASSES[classIndex]);
  const cx = Math.floor(x / size);
  const cy = Math.floor(y / size);
  const cz = Math.floor(z / size);
  const span = Math.ceil(reach / size);
  // A cell counts if any of it is in reach.
  const corner = size * Math.sqrt(3) * 0.5;
  const cells: { cell: [number, number, number]; distance: number }[] = [];
  for (let ix = cx - span; ix <= cx + span; ix++) {
    for (let iy = cy - span; iy <= cy + span; iy++) {
      for (let iz = cz - span; iz <= cz + span; iz++) {
        const distance = Math.hypot((ix + 0.5) * size - x, (iy + 0.5) * size - y, (iz + 0.5) * size - z);
        if (distance <= reach + corner) cells.push({ cell: [ix, iy, iz], distance });
      }
    }
  }
  cells.sort((a, b) => a.distance - b.distance);
  return cells.map((item) => item.cell);
}

/** Mulberry32: small, fast, and the same on every machine. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One number from the class and the place of a cell. */
function cellSeed(classIndex: number, ix: number, iy: number, iz: number): number {
  let h = 0x811c9dc5 ^ classIndex;
  for (const value of [ix, iy, iz]) {
    h = Math.imul(h ^ (value & 0xffff), 0x01000193);
    h = Math.imul(h ^ ((value >>> 16) & 0xffff), 0x01000193);
  }
  return h >>> 0;
}

/** A count with the given average, as a count of rare events comes out (Poisson). */
function countAround(mean: number, rand: () => number): number {
  if (mean <= 0) return 0;
  if (mean > 40) {
    // Many events: a bell curve is close enough.
    const u = Math.max(rand(), 1e-12);
    const v = rand();
    return Math.max(0, Math.round(mean + Math.sqrt(mean) * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)));
  }
  const limit = Math.exp(-mean);
  let k = 0;
  let p = rand();
  while (p > limit) {
    k++;
    p *= rand();
  }
  return k;
}

/**
 * The stars of a cell. Always the same for the same cell and plan. The plan
 * is only read within the cell, so a finer or coarser plan changes a cell's
 * stars only where the two differ.
 */
export function cellStars(classIndex: number, ix: number, iy: number, iz: number, plan: Plan): CellStars {
  const starClass = STAR_CLASSES[classIndex];
  const size = cellSize(starClass);
  const rand = random(cellSeed(classIndex, ix, iy, iz));
  const x0 = ix * size;
  const y0 = iy * size;
  const z0 = iz * size;
  const fromCentre = Math.hypot(x0 + size / 2 - GALACTIC_CENTRE[0], y0 + size / 2 - GALACTIC_CENTRE[1]);
  const height = thickness(starClass, fromCentre);

  // The plan at the corners and the middle: the most crowded of them bounds the cell.
  let crowded = 0;
  for (const [fx, fy] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]]) {
    crowded = Math.max(crowded, plan(x0 + fx * size, y0 + fy * size));
  }
  if (crowded <= 0) return { data: new Float32Array(0), count: 0 };
  // The share of the light of the disc between the top and bottom of the cell.
  const below = (z: number) => (z < 0 ? -1 : 1) * (1 - Math.exp(-Math.abs(z) / height));
  const share = Math.abs(below(z0 + size) - below(z0)) / 2;
  const mean = starClass.density * crowded * size * size * 2 * height * share;
  const candidates = Math.min(STARS_PER_CELL * 2, countAround(mean, rand));

  const data = new Float32Array(Math.min(candidates, STARS_PER_CELL) * 7);
  let count = 0;
  const [lightLow, lightHigh] = starClass.light;
  for (let n = 0; n < candidates && count < STARS_PER_CELL; n++) {
    const x = x0 + rand() * size;
    const y = y0 + rand() * size;
    // Height from the thinning of the disc, within the cell.
    const a = below(z0);
    const b = below(z0 + size);
    const t = a + (b - a) * rand();
    const z = (t < 0 ? -1 : 1) * -height * Math.log(1 - Math.min(Math.abs(t), 0.999999));
    const keep = rand();
    const light = lightLow * (lightHigh / lightLow) ** (rand() ** 1.6);
    const hot = starClass.hot && rand() < starClass.hot.share;
    const [low, high] = hot && starClass.hot ? starClass.hot.teff : starClass.teff;
    const teff = low + (high - low) * rand();
    // Fewer stars in the gaps between the arms than in the arms.
    if (keep > plan(x, y) / crowded) continue;
    const [red, green, blue] = starColor(teff);
    data.set([x, y, z, red, green, blue, light], count * 7);
    count++;
  }
  return { data: count * 7 === data.length ? data : data.slice(0, count * 7), count };
}
