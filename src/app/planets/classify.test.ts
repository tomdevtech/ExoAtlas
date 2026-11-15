import { describe, expect, it } from "vitest";
import { classifyClimate, classifyPlanet, radiusFromMass } from "./classify";

describe("classifyPlanet", () => {
  it("classifies by radius with limits at 1.25, 2 and 6 Earth radii", () => {
    expect(classifyPlanet(1, null)).toBe("rocky");
    expect(classifyPlanet(1.24, null)).toBe("rocky");
    expect(classifyPlanet(1.25, null)).toBe("super_earth");
    expect(classifyPlanet(1.99, null)).toBe("super_earth");
    expect(classifyPlanet(2, null)).toBe("neptune_like");
    expect(classifyPlanet(6, null)).toBe("neptune_like");
    expect(classifyPlanet(6.01, null)).toBe("gas_giant");
  });

  it("uses the radius even when a mass is known", () => {
    expect(classifyPlanet(1, 300)).toBe("rocky");
  });

  it("estimates the radius from the mass when it is missing", () => {
    expect(classifyPlanet(null, 1)).toBe("rocky");
    expect(classifyPlanet(null, 3)).toBe("super_earth");
    expect(classifyPlanet(null, 17)).toBe("neptune_like");
    expect(classifyPlanet(null, 318)).toBe("gas_giant");
  });

  it("returns nothing when radius and mass are both missing", () => {
    expect(classifyPlanet(null, null)).toBeNull();
  });
});

describe("radiusFromMass", () => {
  it("roughly matches Earth, Neptune and Jupiter", () => {
    expect(radiusFromMass(1)).toBeCloseTo(1, 1);
    expect(radiusFromMass(17.1)).toBeGreaterThan(3.5);
    expect(radiusFromMass(17.1)).toBeLessThan(5);
    expect(radiusFromMass(317.8)).toBeGreaterThan(10);
    expect(radiusFromMass(317.8)).toBeLessThan(15);
  });

  it("has no jump where the formula changes", () => {
    expect(radiusFromMass(2.0399)).toBeCloseTo(radiusFromMass(2.04), 1);
    expect(radiusFromMass(131.59)).toBeCloseTo(radiusFromMass(131.6), 0);
  });
});

describe("classifyClimate", () => {
  it("classifies by equilibrium temperature", () => {
    expect(classifyClimate(149)).toBe("frozen");
    expect(classifyClimate(150)).toBe("cold");
    expect(classifyClimate(250)).toBe("temperate");
    expect(classifyClimate(349)).toBe("temperate");
    expect(classifyClimate(350)).toBe("hot");
    expect(classifyClimate(1000)).toBe("hot");
    expect(classifyClimate(1001)).toBe("scorching");
  });

  it("returns nothing when the temperature is missing", () => {
    expect(classifyClimate(null)).toBeNull();
  });
});
