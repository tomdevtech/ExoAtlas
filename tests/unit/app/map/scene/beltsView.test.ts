import { describe, expect, it } from "vitest";
import { orbitPoint } from "@/app/map/orbits";
import type { MapSmallMoon } from "@/app/map/payload";
import { orbitAxes } from "@/app/map/scene/beltsView";
import { smallMoonAxes } from "@/app/map/scene/smallMoonsView";

/** The position a body reaches in view axes, as BELT_VERTEX computes it, before the distances are squeezed. */
function position(axes: ReturnType<typeof orbitAxes>, i: number, x: number, y: number): number[] {
  return [0, 1, 2].map((k) => x * axes.toPeriapsis[i * 3 + k] + y * axes.ahead[i * 3 + k]);
}

describe("orbitAxes", () => {
  it("spans every orbit with two perpendicular unit vectors", () => {
    const plane = new Float32Array([0.3, 1.1, 2.4, 2.7, -0.4, 0.9, 0, 0, 0]);
    const axes = orbitAxes(plane, 3);
    for (let i = 0; i < 3; i++) {
      const p = Array.from(axes.toPeriapsis.subarray(i * 3, i * 3 + 3));
      const q = Array.from(axes.ahead.subarray(i * 3, i * 3 + 3));
      expect(Math.hypot(...p)).toBeCloseTo(1, 5);
      expect(Math.hypot(...q)).toBeCloseTo(1, 5);
      expect(p[0] * q[0] + p[1] * q[1] + p[2] * q[2]).toBeCloseTo(0, 5);
    }
  });

  it("puts an orbit in the ecliptic on the same path as the planets", () => {
    // Without inclination, node and periapsis add up to the planets' periapsis, and the plane is y = 0.
    const periapsis = 0.7;
    const axes = orbitAxes(new Float32Array([0, 0.3, periapsis - 0.3]), 1);
    for (const anomaly of [0, 1, 2.5, 4]) {
      const [x, y] = orbitPoint(1, 0.2, 0, anomaly);
      const [px, py] = orbitPoint(1, 0.2, periapsis, anomaly);
      const [vx, vy, vz] = position(axes, 0, x, y);
      expect(vx).toBeCloseTo(px, 5);
      expect(vy).toBeCloseTo(0, 5);
      expect(vz).toBeCloseTo(-py, 5);
    }
  });

  it("lifts an inclined orbit above the ecliptic after its ascending node", () => {
    // 90 degrees past the node the body is highest, at the sine of the inclination.
    const axes = orbitAxes(new Float32Array([0.5, 1, 0]), 1);
    expect(position(axes, 0, 0, 1)[1]).toBeCloseTo(Math.sin(0.5), 5);
  });
});

describe("smallMoonAxes", () => {
  // A moon in the equator and one in the ecliptic, both without inclination.
  const moons: MapSmallMoon[] = [
    ["Inner", 100000, 0, 0, 0, 0, 0, 1, 10, 0],
    ["Outer", 9000000, 0.2, 0, 0, 0, 0, 500, 3, 1],
  ];

  it("tilts orbits in the equator with the planet's axis and leaves those in the ecliptic", () => {
    const axes = smallMoonAxes(moons, 30);
    // The equatorial orbit's periapsis direction turns about z by the tilt, as the planet's axis does.
    expect(axes.toPeriapsis[0]).toBeCloseTo(Math.cos((-30 * Math.PI) / 180), 5);
    expect(axes.toPeriapsis[1]).toBeCloseTo(Math.sin((-30 * Math.PI) / 180), 5);
    expect(Array.from(axes.toPeriapsis.subarray(3, 6))).toEqual([1, 0, -0]);
  });
});
