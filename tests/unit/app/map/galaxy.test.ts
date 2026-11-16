import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { GALACTIC_CENTRE, GALAXY_EDGE, GALAXY_PICTURE_WIDTH, starColor } from "@/app/map/galaxy";

describe("the picture of the galaxy", () => {
  it("has the galactic centre in its middle and the Sun where the artist drew it", () => {
    // The shader reads the picture at 0.5 + x / width, counted from the centre (see GALAXY_GLOW_FRAGMENT).
    const sun = 0.5 + (0 - GALACTIC_CENTRE[0]) / GALAXY_PICTURE_WIDTH;
    expect(sun).toBeCloseTo(0.5 - 0.191, 6);
    // 43,000 parsecs across: the disc of stars is some 30,000 wide, and the picture leaves room around it.
    expect(GALAXY_PICTURE_WIDTH).toBeGreaterThan(40_000);
    expect(GALAXY_PICTURE_WIDTH).toBeLessThan(46_000);
  });

  it("ends inside the picture", () => {
    expect(GALAXY_EDGE).toBeLessThan(GALAXY_PICTURE_WIDTH / 2);
    // The Sun is well inside.
    expect(GALACTIC_CENTRE[0]).toBeLessThan(GALAXY_EDGE / 2);
  });

  // The scale above only holds for the picture it was measured on. These
  // notice when the file is swapped for another view of the galaxy.
  for (const [name, size] of [["galaxy-sm", 2048], ["galaxy-lg", 4096]] as const) {
    it(`${name}.jpg is square, with the bright core in its middle and nothing at its edges`, async () => {
      const file = path.resolve("public/textures/sky", `${name}.jpg`);
      const picture = await sharp(file).metadata();
      expect([picture.width, picture.height]).toEqual([size, size]);

      // Shrunk and blurred, the brightest place is the core of the galaxy.
      const small = 128;
      const { data } = await sharp(file).resize(small, small).blur(2).greyscale().raw().toBuffer({ resolveWithObject: true });
      let brightest = 0;
      for (let i = 1; i < data.length; i++) if (data[i] > data[brightest]) brightest = i;
      expect(Math.abs((brightest % small) - small / 2)).toBeLessThanOrEqual(3);
      expect(Math.abs(Math.floor(brightest / small) - small / 2)).toBeLessThanOrEqual(3);

      // The corners and the middle of each edge are black: the galaxy does not run out of the picture.
      const at = (x: number, y: number) => data[y * small + x];
      const last = small - 1;
      for (const [x, y] of [[0, 0], [last, 0], [0, last], [last, last], [64, 0], [64, last], [0, 64], [last, 64]]) {
        expect(at(x, y), `at ${x}, ${y}`).toBeLessThan(12);
      }
      // Where the Sun is, 19.1 % below the middle, the disc of the galaxy shines.
      expect(at(64, Math.round(small * (0.5 + 0.191)))).toBeGreaterThan(40);
    });
  }
});

describe("starColor", () => {
  it("makes cool stars orange, hot stars bluish, and the Sun nearly white", () => {
    const [coolRed, , coolBlue] = starColor(3000);
    const [hotRed, , hotBlue] = starColor(15000);
    const sun = starColor(5772);
    expect(coolRed).toBeGreaterThan(coolBlue + 0.3);
    expect(hotBlue).toBeGreaterThan(hotRed);
    expect(Math.min(...sun)).toBeGreaterThan(0.85);
  });

  it("stays between 0 and 1 for every temperature, also absurd ones", () => {
    for (const temperature of [null, -5, 0, 500, 1900, 6600, 40000, 1e9]) {
      for (const channel of starColor(temperature)) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
    }
  });

  it("assumes a star like the Sun when the temperature is unknown", () => {
    expect(starColor(null)).toEqual(starColor(5600));
  });
});
