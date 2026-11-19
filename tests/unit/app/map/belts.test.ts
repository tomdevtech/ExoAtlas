import { describe, expect, it } from "vitest";
import { BELT_COUNTS, gapFactor, KIRKWOOD_GAPS, solarSystemBelts } from "@/app/map/belts";
import { viewPeriod } from "@/app/map/orbits";

const JUPITER = { jupiterLongitude: 1.2, jupiterPeriod: 68 };
const belts = solarSystemBelts(JUPITER);
const total = Object.values(BELT_COUNTS).reduce((sum, count) => sum + count, 0);

/** The orbit and plane of every point as plain objects. */
const bodies = Array.from({ length: belts.count }, (_, i) => ({
  axis: belts.orbit[i * 4],
  eccentricity: belts.orbit[i * 4 + 1],
  anomaly: belts.orbit[i * 4 + 2],
  period: belts.orbit[i * 4 + 3],
  inclination: belts.plane[i * 3],
  node: belts.plane[i * 3 + 1],
  periapsis: belts.plane[i * 3 + 2],
}));

/** An angle folded into -π to π. */
const fold = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

describe("solarSystemBelts", () => {
  it("fills every point it allocates", () => {
    expect(belts.count).toBe(total);
    expect(belts.orbit).toHaveLength(total * 4);
    expect(belts.plane).toHaveLength(total * 3);
    expect(belts.color).toHaveLength(total * 3);
    for (const value of [...belts.orbit, ...belts.plane, ...belts.color]) expect(Number.isFinite(value)).toBe(true);
  });

  it("is the same on every visit", () => {
    expect(solarSystemBelts(JUPITER)).toEqual(belts);
    expect(solarSystemBelts({ ...JUPITER, seed: 2 }).orbit).not.toEqual(belts.orbit);
  });

  it("keeps the main belt between Mars and Jupiter and empties the Kirkwood gaps", () => {
    const main = bodies.filter((body) => body.axis > 2 && body.axis < 3.5);
    expect(main.length).toBeGreaterThanOrEqual(BELT_COUNTS.asteroids);
    for (const [gap, halfWidth] of KIRKWOOD_GAPS.slice(1)) {
      const inside = main.filter((body) => Math.abs(body.axis - gap) < halfWidth * 0.3).length;
      // The outermost gap lies near the edge of the belt, so the busier side is the comparison.
      const near = (axis: number) => main.filter((body) => Math.abs(body.axis - axis) < halfWidth * 0.3).length;
      const beside = Math.max(near(gap - halfWidth * 3), near(gap + halfWidth * 3));
      expect(inside, `gap at ${gap} AU`).toBeLessThan(beside * 0.25 + 1);
    }
    expect(gapFactor(2.502)).toBeLessThan(0.01);
    expect(gapFactor(2.7)).toBeGreaterThan(0.95);
  });

  it("gathers the trojans 60 degrees ahead of Jupiter and behind it, moving with it", () => {
    const trojans = bodies.filter((body) => Math.abs(body.axis - 5.2) < 0.5);
    expect(trojans).toHaveLength(BELT_COUNTS.trojans);
    for (const body of trojans) {
      expect(body.period).toBe(JUPITER.jupiterPeriod);
      const fromJupiter = fold(body.node + body.periapsis + body.anomaly - JUPITER.jupiterLongitude);
      expect(Math.abs(Math.abs(fromJupiter) - Math.PI / 3)).toBeLessThan(Math.PI / 3);
    }
  });

  it("lets the Hildas orbit three times while Jupiter orbits twice", () => {
    const hildas = bodies.filter((body) => body.axis > 3.7 && body.axis < 4.3);
    expect(hildas).toHaveLength(BELT_COUNTS.hildas);
    for (const body of hildas) expect(body.period).toBeCloseTo((JUPITER.jupiterPeriod * 2) / 3, 4);
  });

  it("puts the Kuiper belt beyond Neptune, mostly between 30 and 50 AU", () => {
    const kuiper = bodies.filter((body) => body.axis > 30 && body.axis < 1000);
    expect(kuiper).toHaveLength(BELT_COUNTS.kuiper);
    const classical = kuiper.filter((body) => body.axis < 50).length;
    expect(classical / kuiper.length).toBeGreaterThan(0.75);
    // Even the scattered disc comes no closer to the Sun than Neptune.
    for (const body of kuiper) expect(body.axis * (1 - body.eccentricity)).toBeGreaterThan(29);
  });

  it("lets the belts move at the pace of the planets", () => {
    const sample = bodies.find((body) => body.axis > 2 && body.axis < 3.5)!;
    expect(sample.period).toBeCloseTo(viewPeriod(365.25 * sample.axis ** 1.5), 3);
  });

  it("holds the Oort cloud still between 2,000 and 100,000 AU", () => {
    const oort = bodies.filter((body) => body.axis >= 1000);
    expect(oort).toHaveLength(BELT_COUNTS.oort);
    for (const body of oort) {
      expect(body.period).toBe(0);
      expect(body.axis).toBeGreaterThanOrEqual(2000);
      expect(body.axis).toBeLessThanOrEqual(100000);
    }
    // The inner cloud is flatter than the outer one.
    const height = (list: typeof oort) => list.reduce((sum, body) => sum + Math.abs(Math.sin(body.inclination)), 0) / list.length;
    expect(height(oort.filter((body) => body.axis < 5000))).toBeLessThan(height(oort.filter((body) => body.axis > 20000)));
  });

  it("keeps the colours dim enough to stay in the background", () => {
    for (const value of belts.color) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(0.6);
    }
  });
});
