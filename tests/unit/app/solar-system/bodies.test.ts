import { describe, expect, it } from "vitest";
import { SOLAR_SYSTEM_PLANETS } from "@/app/solar-system/data";
import {
  bodyAppearance,
  describeBody,
  DWARF_PLANETS,
  massEarth,
  moonsOf,
  parentHref,
  parentName,
  radiusEarth,
  SOLAR_BODIES,
  solarBody,
  surfaceGravity,
} from "@/app/solar-system/bodies";
import { isSlug } from "@/shared/slug";

const PLANETS = new Set(SOLAR_SYSTEM_PLANETS.map((planet) => planet.slug));

describe("the moons and dwarf planets", () => {
  it("have unique slugs that no planet uses", () => {
    const slugs = SOLAR_BODIES.map((body) => body.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) {
      expect(isSlug(slug), slug).toBe(true);
      expect(PLANETS.has(slug), slug).toBe(false);
    }
  });

  it("orbit a planet, a dwarf planet or the Sun", () => {
    for (const body of SOLAR_BODIES) {
      if (body.kind === "dwarf_planet") expect(body.parent, body.slug).toBe("sun");
      else expect(PLANETS.has(body.parent) || solarBody(body.parent)?.kind === "dwarf_planet", body.slug).toBe(true);
    }
  });

  it("have plausible measurements", () => {
    for (const body of SOLAR_BODIES) {
      expect(body.radiusKm, body.slug).toBeGreaterThan(150);
      expect(body.density, body.slug).toBeGreaterThan(0.9);
      expect(body.density, body.slug).toBeLessThan(4);
      expect(body.eccentricity, body.slug).toBeGreaterThanOrEqual(0);
      expect(body.eccentricity, body.slug).toBeLessThan(0.3);
      expect(body.summary.length, body.slug).toBeGreaterThan(40);
      // The density must agree with mass and radius, which checks the units of all three.
      const derived = (massEarth(body) * 5.9722e27) / ((4 / 3) * Math.PI * (body.radiusKm * 1e5) ** 3);
      expect(derived / body.density, body.slug).toBeCloseTo(1, 1);
    }
  });

  it("derive mass, radius and gravity in the units the pages show", () => {
    const moon = solarBody("moon")!;
    expect(massEarth(moon)).toBeCloseTo(0.0123, 4);
    expect(radiusEarth(moon)).toBeCloseTo(0.2727, 3);
    expect(surfaceGravity(moon)).toBeCloseTo(1.62, 2);
    // Ganymede is wider than Mercury but has less than half its mass.
    const ganymede = solarBody("ganymede")!;
    expect(radiusEarth(ganymede)).toBeGreaterThan(0.383);
    expect(massEarth(ganymede)).toBeLessThan(0.0553 / 2);
  });

  it("lists the moons of a body from the inside out", () => {
    expect(moonsOf("jupiter").map((moon) => moon.slug)).toEqual(["io", "europa", "ganymede", "callisto"]);
    expect(moonsOf("saturn").map((moon) => moon.slug)).toEqual([
      "mimas",
      "enceladus",
      "tethys",
      "dione",
      "rhea",
      "titan",
      "iapetus",
    ]);
    expect(moonsOf("pluto").map((moon) => moon.slug)).toEqual(["charon"]);
    expect(moonsOf("mercury")).toEqual([]);
    expect(DWARF_PLANETS.map((body) => body.slug)).toEqual(["ceres", "pluto"]);
  });

  it("marks Triton as orbiting backwards and the Moon as measured against the ecliptic", () => {
    expect(solarBody("triton")!.inclinationDeg).toBeGreaterThan(90);
    expect(SOLAR_BODIES.filter((body) => body.ecliptic).map((body) => body.slug)).toEqual(["moon"]);
  });

  it("say what they orbit and link to it", () => {
    expect(describeBody(solarBody("titan")!)).toBe("Moon of Saturn");
    expect(describeBody(solarBody("ceres")!)).toBe("Dwarf planet");
    expect(parentName(solarBody("charon")!)).toBe("Pluto");
    expect(parentHref(solarBody("charon")!)).toBe("/solar-system/pluto");
    expect(parentHref(solarBody("europa")!)).toBe("/planets/jupiter");
    expect(parentHref(solarBody("pluto")!)).toBe("/stars/sun");
  });

  it("each show their own real map, without an atmosphere except for Titan", () => {
    for (const body of SOLAR_BODIES) {
      const { globe, atmosphere } = bodyAppearance(body);
      expect(globe.kind, body.slug).toBe("map");
      expect(globe.maps.day, body.slug).toBe(body.slug);
      expect(globe.rings, body.slug).toBeNull();
      expect(atmosphere !== null, body.slug).toBe(body.slug === "titan");
    }
  });
});
