import { describe, expect, it } from "vitest";
import type { MapSmallMoon } from "@/app/map/payload";
import { BeltsView } from "@/app/map/scene/beltsView";
import { HAZE_LAYER } from "@/app/map/scene/hazeLayer";
import { smallMoonRadius, SmallMoonsView } from "@/app/map/scene/smallMoonsView";
import { Vector3 } from "three";
import { BELT_COUNTS } from "@/app/map/belts";
import { compressedMoonDistance, layoutMoons, layoutOrbits, moonSize, moonViewPeriod } from "@/app/map/orbits";

const MOONS: MapSmallMoon[] = [
  ["Pan", 133584, 0, 0, 0, 0, 0, 0.575, 14, 0],
  ["Phoebe", 12929400, 0.164, 175.2, 192.7, 240.3, 308, 550.3, 106.5, 1],
  ["S/2004 S 12", 19650000, 0.33, 165, 10, 20, 30, 1048, 2.5, 1],
];

describe("SmallMoonsView", () => {
  const knots = layoutMoons(
    [{ semiMajorAxisKm: 1221900, orbitalPeriodDays: 15.9, eccentricity: 0.03, radiusKm: 2575 }],
    { radiusKm: 58232, size: 0.33, reach: 2.27 },
  );
  const view = new SmallMoonsView(MOONS, 58232, 26.7, knots);
  const [orbits, points] = view.group.children as unknown as [
    { layers: { isEnabled(layer: number): boolean }; geometry: { attributes: { position: { count: number } } } },
    { geometry: { instanceCount: number; boundingSphere: { radius: number }; attributes: Record<string, { count: number; array: Float32Array }> } },
  ];

  it("draws every moon as one instance of a quad, in radii of the planet", () => {
    expect(points.geometry.instanceCount).toBe(3);
    const orbit = points.geometry.attributes.orbit.array;
    expect(orbit[0]).toBeCloseTo(133584 / 58232, 6);
    // The bounds reach the farthest apoapsis, so frustum culling never drops a moon.
    expect(points.geometry.boundingSphere.radius).toBeCloseTo((19650000 / 58232) * 1.33, 3);
    // A moon of 100 km or more is drawn at full brightness, a tiny one dim.
    const light = points.geometry.attributes.light.array;
    expect(light[1]).toBe(1);
    expect(light[2]).toBeLessThan(light[0]);
  });

  it("draws all orbits in one set of line segments, in the haze instead of the picture", () => {
    expect(orbits.geometry.attributes.position.count).toBe(3 * 64 * 2);
    expect(orbits.layers.isEnabled(HAZE_LAYER)).toBe(true);
    expect(orbits.layers.isEnabled(0)).toBe(false);
  });

  it("shows nothing while faded out and scales with the planet", () => {
    view.update(10, { width: 800, height: 600, pixelRatio: 1 }, 0.3, 0, 0);
    expect(view.group.visible).toBe(false);
    view.update(10, { width: 800, height: 600, pixelRatio: 1 }, 0.3, 1, 1);
    // The points and the orbit lines squeeze together, from the large moons' layout.
    const points = view.group.children[1] as unknown as { material: { uniforms: Record<string, { value: unknown }> } };
    expect(points.material.uniforms.uTrue.value).toBe(1);
    expect((points.material.uniforms.uKnotView.value as number[])[0]).toBeCloseTo(knots[0].compressedDistance, 9);
    expect(view.group.visible).toBe(true);
    expect(view.group.scale.x).toBe(0.3);
    view.dispose();
  });
});

describe("SmallMoonsView.place", () => {
  const knots = layoutMoons(
    [{ semiMajorAxisKm: 1221900, orbitalPeriodDays: 15.9, eccentricity: 0.03, radiusKm: 2575 }],
    { radiusKm: 58232, size: 0.33, reach: 2.27 },
  );
  const view = new SmallMoonsView(MOONS, 58232, 0, knots);
  const at = (index: number, clock: number, trueScale: number) => view.place(index, clock, trueScale, new Vector3());

  it("follows a moon at its true distance in the true scale, and squeezed in the compressed scale", () => {
    // Pan's orbit is a circle, so its distance never changes.
    for (const clock of [0, 3.3, 17]) expect(at(0, clock, 1).length()).toBeCloseTo(133584 / 58232, 4);
    expect(at(0, 0, 0).length()).toBeCloseTo(compressedMoonDistance(knots, 133584 / 58232), 4);
    // Far beyond the large moons the compressed scale squeezes hard.
    expect(at(2, 0, 0).length()).toBeLessThan(at(2, 0, 1).length() / 10);
  });

  it("moves the moon along its orbit as time passes, and back to the start after one period", () => {
    const period = moonViewPeriod(550.3);
    const start = at(1, 0, 1);
    expect(at(1, period / 4, 1).distanceTo(start)).toBeGreaterThan(1);
    expect(at(1, period, 1).distanceTo(start)).toBeLessThan(1e-3);
  });

  it("gives small moons their real size in the true scale and an enlarged one in the compressed scale", () => {
    expect(smallMoonRadius(14, 58232, 0.33, 1)).toBeCloseTo(14 / 58232, 9);
    expect(smallMoonRadius(14, 58232, 0.33, 0)).toBeCloseTo(moonSize(14) / 0.33, 9);
    // A moon of unknown size counts as one kilometre.
    expect(smallMoonRadius(0, 58232, 0.33, 1)).toBeCloseTo(1 / 58232, 9);
  });
});

describe("BeltsView", () => {
  const layouts = layoutOrbits(
    [1.52, 5.2, 30.1].map((axis) => ({ orbitalPeriodDays: null, semiMajorAxisAu: axis, eccentricity: 0, radiusEarth: 1 })),
    { massSun: 1, radiusSun: 1 },
  );
  const belts = new BeltsView(layouts, { jupiterLongitude: 0, jupiterPeriod: 60 });

  it("draws every body of the belts as one instance and hands the orbits to the shader", () => {
    expect(belts.mesh.geometry.instanceCount).toBe(Object.values(BELT_COUNTS).reduce((sum, count) => sum + count, 0));
    const { uniforms } = belts.mesh.material;
    expect(uniforms.uKnots.value).toBe(3);
    expect(uniforms.uKnotAu.value.slice(0, 3)).toEqual(layouts.map((layout) => layout.axisAu));
    expect(uniforms.uKnotAu.value).toHaveLength(16);
  });

  it("is hidden when faded out and follows the scale it is given", () => {
    belts.update(5, { width: 800, height: 600, pixelRatio: 2 }, 0.4, 0);
    expect(belts.mesh.visible).toBe(false);
    belts.update(5, { width: 800, height: 600, pixelRatio: 2 }, 0.4, 1);
    expect(belts.mesh.visible).toBe(true);
    expect(belts.mesh.material.uniforms.uTrue.value).toBe(0.4);
    expect(belts.mesh.material.uniforms.uResolution.value.x).toBe(1600);
    belts.dispose();
  });
});
