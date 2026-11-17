import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import PRESETS from "@/app/planets/globe/presets.json";

/**
 * The base maps in public/textures/presets and what presets.json says about
 * them are made by the same run of `npm run presets` and have to stay
 * together. These tests notice a map that is missing, has the wrong size, or
 * was renewed without its numbers.
 */

const file = (name: string, size: "sm" | "lg") =>
  path.resolve("public/textures/presets", `${name}-${size}.webp`);

const terrain = Object.entries(PRESETS.terrain);
const bands = Object.entries(PRESETS.bands);

describe("the base maps of the planets", () => {
  it("are there in both sizes, twice as wide as high, with three channels", async () => {
    for (const name of [...Object.keys(PRESETS.terrain), ...Object.keys(PRESETS.bands)]) {
      for (const [size, width] of [["sm", 512], ["lg", 2048]] as const) {
        expect(existsSync(file(name, size)), `${name}-${size}.webp`).toBe(true);
        const picture = await sharp(file(name, size)).metadata();
        expect([picture.width, picture.height, picture.channels], `${name}-${size}.webp`).toEqual([width, width / 2, 3]);
      }
    }
  });

  it("come with rising levels from 0 to 1 for every rocky one", () => {
    expect(terrain.length).toBeGreaterThanOrEqual(9);
    for (const [name, { levels }] of terrain) {
      expect(levels, name).toHaveLength(21);
      expect(levels[0], name).toBe(0);
      expect(levels[20], name).toBe(1);
      for (let i = 1; i < levels.length; i++) expect(levels[i], name).toBeGreaterThanOrEqual(levels[i - 1]);
    }
  });

  it("have the heights the levels were counted from", async () => {
    // The level at one half is the height below which half of the surface lies.
    // Counted again from the small map, where a pixel near the poles stands for less ground.
    for (const [name, { levels }] of terrain) {
      const { data, info } = await sharp(file(name, "sm")).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
      let below = 0;
      let all = 0;
      for (let y = 0; y < info.height; y++) {
        const ground = Math.max(Math.cos((0.5 - (y + 0.5) / info.height) * Math.PI), 0.12);
        for (let x = 0; x < info.width; x++) {
          all += ground;
          if (data[y * info.width + x] / 255 < levels[10]) below += ground;
        }
      }
      // The small map is a shrunk copy, so the share is not exact to the pixel.
      expect(below / all, name).toBeGreaterThan(0.4);
      expect(below / all, name).toBeLessThan(0.6);
    }
  });

  it("come with the winds they were simulated with for every banded one", () => {
    expect(bands.length).toBeGreaterThanOrEqual(6);
    for (const [name, winds] of bands) {
      expect(winds.count, name).toBeGreaterThan(0);
      expect(winds.narrowness, name).toBeGreaterThan(0);
      expect(winds.strength, name).toBeGreaterThan(0);
      // The fastest latitude has about the speed 1, forwards or backwards.
      expect(winds.strength + Math.abs(winds.equator), name).toBeCloseTo(1, 2);
      expect(winds.phase, name).toBeGreaterThanOrEqual(0);
      expect(winds.phase, name).toBeLessThan(2 * Math.PI);
    }
  });

  it("name the largest storms of every banded one, where the map has them", async () => {
    for (const [name, winds] of bands) {
      expect(winds.storms.length, name).toBeLessThanOrEqual(6);
      if (name !== "bands-hazy") expect(winds.storms.length, name).toBeGreaterThan(0);
      const { data, info } = await sharp(file(name, "sm")).extractChannel(2).raw().toBuffer({ resolveWithObject: true });
      for (const [lon, lat, size, spin] of winds.storms) {
        expect(Math.abs(spin), name).toBe(1);
        expect(size, name).toBeGreaterThan(0);
        // The blue channel marks the storm at its centre.
        const column = Math.min(info.width - 1, Math.floor((lon / (2 * Math.PI) + 0.5) * info.width));
        const row = Math.min(info.height - 1, Math.floor((0.5 - lat / Math.PI) * info.height));
        let strongest = 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const y = Math.min(info.height - 1, Math.max(0, row + dy));
            const x = (column + dx + info.width) % info.width;
            strongest = Math.max(strongest, data[y * info.width + x]);
          }
        }
        expect(strongest, `${name} at ${lon}, ${lat}`).toBeGreaterThan(150);
      }
    }
  });

  it("keep the storms of the gas giants apart from their belts", async () => {
    // Blue marks the storms: most of a map has none, some of it has.
    for (const [name] of bands) {
      if (name === "bands-hazy") continue;
      const { data } = await sharp(file(name, "sm")).extractChannel(2).raw().toBuffer({ resolveWithObject: true });
      const marked = data.filter((value) => value > 128).length / data.length;
      expect(marked, name).toBeGreaterThan(0);
      expect(marked, name).toBeLessThan(0.2);
    }
  });
});
