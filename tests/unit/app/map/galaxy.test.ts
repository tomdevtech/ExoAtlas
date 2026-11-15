import { describe, expect, it } from "vitest";
import { armAngle, buildGalaxy, GALACTIC_CENTRE, mulberry32, starColor } from "@/app/map/galaxy";

describe("mulberry32", () => {
  it("returns the same numbers for the same seed", () => {
    const a = mulberry32(5);
    const b = mulberry32(5);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("returns numbers from 0 up to, but not including, 1", () => {
    const random = mulberry32(1);
    for (let i = 0; i < 1000; i++) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("buildGalaxy", () => {
  const galaxy = buildGalaxy(4000);

  it("fills every point", () => {
    expect(galaxy.count).toBe(4000);
    expect(galaxy.positions).toHaveLength(12000);
    expect(galaxy.colors).toHaveLength(12000);
    expect(galaxy.sizes).toHaveLength(4000);
    expect(galaxy.alphas).toHaveLength(4000);
    expect(galaxy.positions.every(Number.isFinite)).toBe(true);
    expect(galaxy.colors.every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(galaxy.sizes.every((value) => value > 0)).toBe(true);
    expect(galaxy.alphas.every((value) => value > 0 && value <= 1)).toBe(true);
  });

  it("builds the same galaxy for the same seed", () => {
    expect(buildGalaxy(500, 3).positions).toEqual(buildGalaxy(500, 3).positions);
    expect(buildGalaxy(500, 3).positions).not.toEqual(buildGalaxy(500, 4).positions);
  });

  it("is a flat disc around the galactic centre, not around the Sun", () => {
    let sumX = 0;
    let sumY = 0;
    let flat = 0;
    let far = 0;
    for (let i = 0; i < galaxy.count; i++) {
      const x = galaxy.positions[i * 3];
      const y = galaxy.positions[i * 3 + 1];
      const z = galaxy.positions[i * 3 + 2];
      sumX += x;
      sumY += y;
      if (Math.abs(z) < 2500) flat++;
      if (Math.hypot(x - GALACTIC_CENTRE[0], y - GALACTIC_CENTRE[1]) > 30000) far++;
    }
    expect(Math.abs(sumX / galaxy.count - GALACTIC_CENTRE[0])).toBeLessThan(1500);
    expect(Math.abs(sumY / galaxy.count)).toBeLessThan(1500);
    expect(flat / galaxy.count).toBeGreaterThan(0.9);
    expect(far).toBe(0);
  });
});

describe("armAngle", () => {
  it("spaces the four arms a quarter turn apart", () => {
    expect(armAngle(1, 6000) - armAngle(0, 6000)).toBeCloseTo(Math.PI / 2, 9);
  });

  it("winds the arms on as they run outwards", () => {
    expect(armAngle(0, 12000)).toBeGreaterThan(armAngle(0, 6000));
  });
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
