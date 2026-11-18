import { describe, expect, it } from "vitest";
import { colourise, fillGaps, findGaps, halfTurn, prepareMap, targetBrightness, type Picture } from "../../scripts/moon-maps";
import { MAP_SOURCES } from "@/app/solar-system/maps";
import { SOLAR_BODIES } from "@/app/solar-system/bodies";

/** A picture of `width` × `height` whose pixels `paint` returns as [r, g, b]. */
function picture(width: number, height: number, paint: (x: number, y: number) => [number, number, number]): Picture {
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rgb.set(paint(x, y), (y * width + x) * 3);
  return { width, height, rgb };
}

const at = ({ width, rgb }: Picture, x: number, y: number) => Array.from(rgb.subarray((y * width + x) * 3, (y * width + x) * 3 + 3));
const luminance = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

describe("halfTurn", () => {
  it("moves longitude 180 from the middle to the edges and back", () => {
    const original = picture(8, 2, (x) => [x * 10, 0, 0]);
    const turned = halfTurn(original);
    expect(at(turned, 0, 0)[0]).toBe(40);
    expect(at(turned, 4, 1)[0]).toBe(0);
    expect(halfTurn(turned)).toEqual(original);
  });
});

describe("findGaps", () => {
  it("marks black pixels and a margin round them, wrapping round in longitude", () => {
    const image = picture(10, 5, (x, y) => (x === 0 && y === 2 ? [0, 0, 0] : [120, 110, 100]));
    const gaps = findGaps(image, 1);
    expect(gaps[2 * 10 + 0]).toBe(1);
    expect(gaps[2 * 10 + 1]).toBe(1);
    expect(gaps[2 * 10 + 9]).toBe(1);
    expect(gaps[1 * 10 + 0]).toBe(1);
    expect(gaps[2 * 10 + 2]).toBe(0);
    expect(gaps.reduce((sum, value) => sum + value, 0)).toBe(5);
  });

  it("does not take dark ground for a gap", () => {
    const image = picture(4, 4, () => [12, 10, 9]);
    expect(findGaps(image).every((value) => value === 0)).toBe(true);
  });
});

describe("fillGaps", () => {
  it("continues the surrounding tones smoothly and leaves imaged pixels alone", () => {
    // The southern half is imaged with a brightness that rises from west to east, the north is black.
    const image = picture(64, 32, (x, y) => (y < 16 ? [0, 0, 0] : [40 + x * 2, 40 + x * 2, 40 + x * 2]));
    const gaps = findGaps(image, 0);
    const filled = fillGaps(image, gaps, 4);
    for (let y = 16; y < 32; y++) for (let x = 0; x < 64; x++) expect(at(filled, x, y)).toEqual(at(image, x, y));
    // Just above the edge the fill matches the ground below it (away from the jump of the ramp where the
    // picture wraps round); it never turns black or bright white.
    expect(Math.abs(at(filled, 32, 15)[0] - at(image, 32, 16)[0])).toBeLessThan(12);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 64; x++) {
        expect(at(filled, x, y)[0]).toBeGreaterThanOrEqual(38);
        expect(at(filled, x, y)[0]).toBeLessThanOrEqual(170);
      }
    }
  });

  it("does nothing when nothing was imaged", () => {
    const black = picture(8, 4, () => [0, 0, 0]);
    expect(fillGaps(black, findGaps(black))).toEqual(black);
  });
});

describe("colourise", () => {
  const grey = picture(16, 8, (x) => [x * 16, x * 16, x * 16]);
  const none = new Uint8Array(16 * 8);

  it("tints grey mosaics from the dark to the bright colour and keeps the order of brightness", () => {
    const tinted = colourise(grey, none, { centredOn180: false, colouring: { kind: "grey", dark: "#804020", bright: "#e0e0ff" }, albedo: 0.3 });
    const darkPixel = at(tinted, 3, 0);
    const brightPixel = at(tinted, 14, 0);
    expect(darkPixel[0]).toBeGreaterThan(darkPixel[2]);
    expect(brightPixel[2]).toBeGreaterThanOrEqual(brightPixel[0]);
    for (let x = 1; x < 16; x++) expect(luminance(at(tinted, x, 0))).toBeGreaterThanOrEqual(luminance(at(tinted, x - 1, 0)) - 1);
  });

  it("sets the average brightness after the albedo", () => {
    for (const albedo of [0.09, 0.3, 0.9]) {
      const result = colourise(grey, none, { centredOn180: false, colouring: { kind: "colour", saturation: 1 }, albedo });
      let sum = 0;
      for (let x = 0; x < 16; x++) for (let y = 0; y < 8; y++) sum += luminance(at(result, x, y));
      expect(sum / 128 / 255).toBeCloseTo(targetBrightness(albedo), 1);
    }
    expect(targetBrightness(0.09)).toBeLessThan(targetBrightness(0.9));
  });

  it("tones down colours and leaves the gaps for fillGaps", () => {
    const red = picture(2, 1, () => [200, 60, 60]);
    const gaps = new Uint8Array([0, 1]);
    const result = colourise(red, gaps, { centredOn180: false, colouring: { kind: "colour", saturation: 0.3 }, albedo: 0.3 });
    const [r, g] = at(result, 0, 0);
    // Red was 70 % above green; toned down to 30 % it stays well below half of that.
    expect((r - g) / r).toBeLessThan(0.5 * ((200 - 60) / 200));
    expect(at(result, 1, 0)).toEqual([200, 60, 60]);
  });

  it("veils Titan in its haze with the surface showing only faintly", () => {
    const result = colourise(grey, none, { centredOn180: false, colouring: { kind: "haze", color: "#d39a4c" }, albedo: 0.2 });
    const lightest = luminance(at(result, 15, 0));
    const darkest = luminance(at(result, 0, 0));
    expect(lightest / darkest).toBeLessThan(1.4);
    expect(at(result, 8, 0)[0]).toBeGreaterThan(at(result, 8, 0)[2]);
  });
});

describe("prepareMap", () => {
  it("turns, colours and fills a mosaic, and reports how much was filled", () => {
    const mosaic = picture(32, 16, (x, y) => (y < 4 ? [0, 0, 0] : [90, 90, 90]));
    const { picture: prepared, filled } = prepareMap(mosaic, {
      centredOn180: true,
      colouring: { kind: "grey", dark: "#606060", bright: "#d0d0d0" },
      albedo: 0.3,
    });
    // Four black rows of sixteen, plus the margin of two rows that findGaps adds.
    expect(filled).toBeCloseTo(6 / 16, 6);
    for (let i = 0; i < prepared.rgb.length; i++) expect(prepared.rgb[i]).toBeGreaterThan(20);
  });
});

describe("the map sources", () => {
  it("name a map, a credit and a licence for every body with a page, apart from those never mapped whole", () => {
    // No spacecraft has mapped all of Deimos, Hyperion or the small moons near Saturn's rings; their pages say
    // so and show the shape alone.
    const unmapped = ["deimos", "hyperion", "pan", "daphnis", "atlas", "prometheus", "pandora", "epimetheus", "janus", "telesto", "calypso", "helene"];
    expect(Object.keys(MAP_SOURCES).sort()).toEqual(
      SOLAR_BODIES.map((body) => body.slug)
        .filter((slug) => !unmapped.includes(slug))
        .sort(),
    );
    for (const source of Object.values(MAP_SOURCES)) {
      expect(source.download).toMatch(/^https:\/\//);
      expect(source.url).toMatch(/^https:\/\//);
      expect(source.credit.length).toBeGreaterThan(5);
      expect(source.licence.length).toBeGreaterThan(3);
    }
  });
});
