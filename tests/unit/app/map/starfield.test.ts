import { describe, expect, it } from "vitest";
import { GALACTIC_CENTRE, GALAXY_EDGE, GALAXY_PICTURE_WIDTH } from "@/app/map/galaxy";
import {
  cellKey,
  cellsAround,
  cellSize,
  cellStars,
  planFromPicture,
  reachAt,
  SMOOTH_PLAN,
  STAR_CLASSES,
  starDensity,
  STARS_PER_CLASS,
  type Plan,
} from "@/app/map/starfield";

const SUNS = STAR_CLASSES.findIndex((item) => item.name === "suns");
const GIANTS = STAR_CLASSES.findIndex((item) => item.name === "giants");

describe("the classes of stars", () => {
  it("run from faint and common to bright and rare, each made out further", () => {
    for (let i = 1; i < STAR_CLASSES.length; i++) {
      const [before, after] = [STAR_CLASSES[i - 1], STAR_CLASSES[i]];
      expect(after.light[0], after.name).toBeGreaterThanOrEqual(before.light[1] * 0.9);
      expect(after.density, after.name).toBeLessThan(before.density);
      expect(after.reach, after.name).toBeGreaterThan(before.reach);
    }
  });

  it("end where their faintest star is about as bright as that of the others", () => {
    // Apparent brightness falls with the square of the distance, so the reach
    // must grow with the square root of the light for no class to pop out of the dark.
    const edges = STAR_CLASSES.map((item) => item.light[0] / item.reach ** 2);
    const [low, high] = [Math.min(...edges), Math.max(...edges)];
    expect(high / low).toBeLessThan(15);
  });

  it("leave the stars of the photograph to the photograph near the Sun", () => {
    // The photograph cannot show faint stars, while the bright ones are already in it.
    expect(STAR_CLASSES[0].photographed).toBe(false);
    expect(STAR_CLASSES[STAR_CLASSES.length - 1].photographed).toBe(true);
  });
});

describe("the density of stars", () => {
  it("is about one star in ten cubic parsecs near the Sun, most of them dwarfs", () => {
    const all = STAR_CLASSES.reduce((sum, item) => sum + starDensity(item, SMOOTH_PLAN, 0, 0, 0), 0);
    expect(all).toBeGreaterThan(0.07);
    expect(all).toBeLessThan(0.15);
    expect(starDensity(STAR_CLASSES[0], SMOOTH_PLAN, 0, 0, 0) / all).toBeGreaterThan(0.6);
  });

  it("thins out above the plane and outside the disc, and is crowded towards the centre", () => {
    const suns = STAR_CLASSES[SUNS];
    const here = starDensity(suns, SMOOTH_PLAN, 0, 0, 0);
    expect(starDensity(suns, SMOOTH_PLAN, 0, 0, 600)).toBeLessThan(here * 0.2);
    expect(starDensity(suns, SMOOTH_PLAN, 4000, 0, 0)).toBeGreaterThan(here * 2);
    expect(starDensity(suns, SMOOTH_PLAN, GALACTIC_CENTRE[0] + GALAXY_EDGE + 100, 0, 0)).toBe(0);
  });

  it("follows the arms of the picture", () => {
    // The picture has one bright stripe through the Sun, along the y axis.
    const size = 64;
    const brightness = new Float32Array(size * size).fill(0.01);
    const sunRow = Math.round((0.5 + GALACTIC_CENTRE[0] / GALAXY_PICTURE_WIDTH) * size - 0.5);
    for (let column = 0; column < size; column++) brightness[sunRow * size + column] = 1;
    const plan = planFromPicture(brightness, size);
    expect(plan(0, 3000)).toBeGreaterThan(0.5);
    expect(plan(-4000, 0)).toBeLessThan(0.2);
    // Beyond the edge of the galaxy the plan must be empty.
    expect(plan(GALACTIC_CENTRE[0] + GALAXY_EDGE + 100, 0)).toBe(0);
  });
});

describe("the cells", () => {
  it("make the same stars every time, and other stars next door", () => {
    const a = cellStars(SUNS, 3, -2, 0, SMOOTH_PLAN);
    const b = cellStars(SUNS, 3, -2, 0, SMOOTH_PLAN);
    const c = cellStars(SUNS, 4, -2, 0, SMOOTH_PLAN);
    expect(a.count).toBeGreaterThan(0);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
    expect(Array.from(c.data.slice(0, 7))).not.toEqual(Array.from(a.data.slice(0, 7)));
    expect(cellKey(SUNS, 3, -2, 0)).not.toBe(cellKey(SUNS, 4, -2, 0));
  });

  it("keep their stars inside, with colours and light of their class", () => {
    const size = cellSize(STAR_CLASSES[SUNS]);
    const [ix, iy, iz] = [-2, 1, 0];
    const { data, count } = cellStars(SUNS, ix, iy, iz, SMOOTH_PLAN);
    for (let n = 0; n < count; n++) {
      const [x, y, z, red, green, blue, light] = data.slice(n * 7, n * 7 + 7);
      expect(x).toBeGreaterThanOrEqual(ix * size);
      expect(x).toBeLessThanOrEqual((ix + 1) * size);
      expect(y).toBeGreaterThanOrEqual(iy * size);
      expect(y).toBeLessThanOrEqual((iy + 1) * size);
      expect(z).toBeGreaterThanOrEqual(iz * size - 1e-3);
      expect(z).toBeLessThanOrEqual((iz + 1) * size + 1e-3);
      for (const channel of [red, green, blue]) expect(channel).toBeGreaterThanOrEqual(0);
      expect(light).toBeGreaterThanOrEqual(STAR_CLASSES[SUNS].light[0] - 1e-6);
      expect(light).toBeLessThanOrEqual(STAR_CLASSES[SUNS].light[1] + 1e-6);
    }
  });

  it("hold about as many stars as the density says where the galaxy is crowded too", () => {
    // A plan five times as crowded as near the Sun gives hundreds of stars per cell.
    const crowded: Plan = () => 5;
    const starClass = STAR_CLASSES[SUNS];
    const size = cellSize(starClass);
    let stars = 0;
    let expected = 0;
    for (let ix = 0; ix < 4; ix++) {
      const count = cellStars(SUNS, ix, 0, 0, crowded).count;
      stars += count;
      expected += starDensity(starClass, crowded, (ix + 0.5) * size, 0.5 * size, 0) *
        size * size * starClass.height * (1 - Math.exp(-size / starClass.height));
    }
    expect(expected / 4).toBeGreaterThan(100);
    expect(stars / expected).toBeGreaterThan(0.85);
    expect(stars / expected).toBeLessThan(1.15);
    // A cell is capped at 6,000 stars however crowded it is.
    expect(cellStars(SUNS, 0, 0, 0, () => 40).count).toBe(6000);
  });

  it("hold about as many stars as the density says", () => {
    const starClass = STAR_CLASSES[SUNS];
    const size = cellSize(starClass);
    let stars = 0;
    let expected = 0;
    for (let ix = -3; ix < 3; ix++) {
      for (let iy = -3; iy < 3; iy++) {
        stars += cellStars(SUNS, ix, iy, 0, SMOOTH_PLAN).count;
        // The expected count integrates the density over the column of the cell from the plane up to its top.
        expected += starDensity(starClass, SMOOTH_PLAN, (ix + 0.5) * size, (iy + 0.5) * size, 0) *
          size * size * starClass.height * (1 - Math.exp(-size / starClass.height));
      }
    }
    expect(stars / expected).toBeGreaterThan(0.85);
    expect(stars / expected).toBeLessThan(1.15);
  });

  it("around a point are the ones in reach, nearest first", () => {
    const reach = STAR_CLASSES[SUNS].reach;
    const size = cellSize(STAR_CLASSES[SUNS]);
    const cells = cellsAround(SUNS, reach, 10, -5, 2);
    expect(cells[0]).toEqual([0, -1, 0]);
    for (const [ix, iy, iz] of cells) {
      const distance = Math.hypot((ix + 0.5) * size - 10, (iy + 0.5) * size + 5, (iz + 0.5) * size - 2);
      expect(distance).toBeLessThanOrEqual(reach + size);
    }
    // A sphere with a radius of three cells holds a few hundred cells, not thousands.
    expect(cells.length).toBeGreaterThan(100);
    expect(cells.length).toBeLessThan(400);
  });
});

describe("the reach", () => {
  it("is nearly the full one near the Sun and shrinks where the galaxy is crowded", () => {
    const suns = STAR_CLASSES[SUNS];
    expect(reachAt(suns, SMOOTH_PLAN, 0, 0, 0)).toBeGreaterThan(suns.reach * 0.8);
    const giants = STAR_CLASSES[GIANTS];
    const nearSun = reachAt(giants, SMOOTH_PLAN, 0, 0, 0);
    expect(nearSun).toBeGreaterThan(giants.reach * 0.5);
    const nearCentre = reachAt(giants, SMOOTH_PLAN, GALACTIC_CENTRE[0] - 500, 0, 0);
    expect(nearCentre).toBeLessThan(nearSun * 0.7);
    // The reach shrinks near the centre so that the class keeps to its star budget there.
    const plan = SMOOTH_PLAN(GALACTIC_CENTRE[0] - 500, 0);
    const inReach = giants.density * plan * Math.PI * nearCentre ** 2 * 2 * Math.min(nearCentre, giants.height * 3);
    expect(inReach).toBeLessThan(STARS_PER_CLASS * 2);
  });

  it("is the full one high above the disc, where few stars are", () => {
    for (const starClass of STAR_CLASSES) {
      expect(reachAt(starClass, SMOOTH_PLAN, 0, 0, 20_000)).toBe(starClass.reach);
    }
  });
});
