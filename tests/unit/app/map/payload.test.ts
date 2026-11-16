import { describe, expect, it } from "vitest";
import { toMapStar, toMapSystem, type SystemPlanetRow, type SystemStarRow } from "@/app/map/payload";

const STAR: SystemStarRow = {
  slug: "trappist-1",
  name: "TRAPPIST-1",
  source: "nasa",
  teffK: 2566,
  radiusSun: 0.12,
  massSun: 0.09,
  distPc: 12.43,
};

function planet(overrides: Partial<SystemPlanetRow> = {}): SystemPlanetRow {
  return {
    slug: "trappist-1-e",
    name: "TRAPPIST-1 e",
    source: "nasa",
    planetClass: "rocky",
    climateClass: "temperate",
    orbitalPeriodDays: 6.1,
    semiMajorAxisAu: 0.029,
    eccentricity: 0.005,
    radiusEarth: 0.92,
    eqTempK: 251,
    densityEarth: null,
    ...overrides,
  };
}

describe("toMapStar", () => {
  it("packs a star into a short list and rounds what nobody can see", () => {
    expect(
      toMapStar({
        slug: "proxima-cen",
        name: "Proxima Cen",
        x: 0.4712345,
        y: -0.3609876,
        z: -1.1554321,
        teffK: 2900.4,
        planetCount: 2,
      }),
    ).toEqual(["proxima-cen", "Proxima Cen", 0.471, -0.361, -1.155, 2900, 2]);
  });

  it("keeps an unknown temperature unknown", () => {
    const star = toMapStar({ slug: "x", name: "X", x: 1, y: 2, z: 3, teffK: null, planetCount: 1 });
    expect(star[5]).toBeNull();
  });
});

describe("toMapSystem", () => {
  it("marks the Sun and no other star as our own", () => {
    expect(toMapSystem(STAR, []).star.isSun).toBe(false);
    expect(toMapSystem({ ...STAR, slug: "sun", source: "sol" }, []).star.isSun).toBe(true);
  });

  it("describes every planet and gives it the look of its page", () => {
    const { planets } = toMapSystem(STAR, [planet(), planet({ slug: "trappist-1-b", name: "TRAPPIST-1 b" })]);
    expect(planets.map((item) => item.slug)).toEqual(["trappist-1-e", "trappist-1-b"]);
    expect(planets[0].description).toBe("Rocky planet, temperate");
    expect(planets[0].globe.kind).toBe("terrain");
    expect(planets[0].globe.seed).not.toBe(planets[1].globe.seed);
  });

  it("uses the real maps for the planets of the solar system", () => {
    const sun: SystemStarRow = { ...STAR, slug: "sun", name: "Sun", source: "sol", teffK: 5772 };
    const { planets } = toMapSystem(sun, [
      planet({ slug: "earth", name: "Earth", source: "sol" }),
      planet({ slug: "saturn", name: "Saturn", source: "sol", planetClass: "gas_giant", climateClass: "frozen" }),
    ]);
    expect(planets[0].globe.kind).toBe("map");
    expect(planets[0].globe.maps?.day).toBe("earth");
    expect(planets[1].globe.rings).not.toBeNull();
  });

  it("passes missing measurements on as missing", () => {
    const { planets } = toMapSystem(STAR, [
      planet({ planetClass: null, climateClass: null, orbitalPeriodDays: null, radiusEarth: null }),
    ]);
    expect(planets[0].orbitalPeriodDays).toBeNull();
    expect(planets[0].radiusEarth).toBeNull();
    expect(planets[0].description.length).toBeGreaterThan(0);
  });
});
