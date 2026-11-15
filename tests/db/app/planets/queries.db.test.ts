import { describe, expect, it } from "vitest";
import { ACTIVE_EXOPLANETS } from "@tests/support/catalog";
import { PAGE_SIZE } from "@/app/planets/paging";
import {
  findPlanetSlugByAlias,
  getPlanet,
  getPlanetChanges,
  getPlanetFormerNames,
  getPlanetsBySlug,
  getPlanetsOfStar,
  listPlanets,
} from "@/app/planets/queries";

/** Exoplanets of the test catalogue plus the eight planets of the solar system. */
const ALL_ACTIVE = ACTIVE_EXOPLANETS + 8;

describe("listPlanets", () => {
  it("lists every active planet, but not the withdrawn one", async () => {
    const { planets, total, page } = await listPlanets("", 1);
    expect(total).toBe(ALL_ACTIVE);
    expect(page).toBe(1);
    expect(planets).toHaveLength(Math.min(ALL_ACTIVE, PAGE_SIZE));
    expect(planets.map((p) => p.name)).not.toContain("Retracted-1 b");
  });

  it("sorts names the way people read numbers", async () => {
    const names = (await listPlanets("kepler", 1)).planets.map((p) => p.name);
    expect(names).toEqual(["Kepler-12 b", "Kepler-22 b", "Kepler-129 b", "Kepler-220 b"]);
  });

  it("sorts by discovery year, newest first, unknown years last", async () => {
    const { planets } = await listPlanets("", 1, "discovery");
    const years = planets.map((p) => p.discoveryYear);
    const known = years.filter((year) => year !== null);
    expect(known).toEqual([...known].sort((a, b) => b - a));
    expect(years.slice(known.length).every((year) => year === null)).toBe(true);
    expect(planets[0].name).toBe("Nodist-1 b");
  });

  it("filters by the name of the planet and of its star", async () => {
    expect((await listPlanets("trappist", 1)).total).toBe(7);
    expect((await listPlanets("TRAPPIST-1 e", 1)).planets.map((p) => p.name)).toEqual([
      "TRAPPIST-1 e",
    ]);
    // "Sun" is the name of the star, none of its planets carries it.
    expect((await listPlanets("sun", 1)).total).toBe(8);
  });

  it("finds nothing for filters without letters or digits", async () => {
    for (const filter of ["?", "%", "_", "'--", "   -  "]) {
      const result = await listPlanets(filter, 1);
      expect(result, filter).toEqual({ planets: [], total: 0, page: 1 });
    }
  });

  it("shows the last page when the page asked for does not exist", async () => {
    const result = await listPlanets("", 999);
    expect(result.page).toBe(1);
    expect(result.planets.length).toBeGreaterThan(0);
  });

  it("does not break on hostile filters", async () => {
    for (const filter of ["' OR 1=1 --", "a".repeat(10_000), "\u0000", "%%%%"]) {
      const result = await listPlanets(filter, 1);
      expect(result.total, filter.slice(0, 20)).toBeLessThan(ALL_ACTIVE);
    }
  });
});

describe("single planets", () => {
  it("reads a planet with its star", async () => {
    const found = await getPlanet("trappist-1-e");
    expect(found?.planet.name).toBe("TRAPPIST-1 e");
    expect(found?.star.name).toBe("TRAPPIST-1");
    expect(found?.planet.planetClass).not.toBeNull();
  });

  it("answers null for unknown or odd slugs", async () => {
    for (const slug of ["nope", "", "../../etc/passwd", "trappist-1-e' or '1'='1", "%"]) {
      expect(await getPlanet(slug), slug).toBeNull();
    }
  });

  it("finds the current slug from a former one", async () => {
    expect(await findPlanetSlugByAlias("koi-87-01")).toBe("kepler-22-b");
    expect(await findPlanetSlugByAlias("kepler-22-b")).toBeNull();
    const kepler22 = await getPlanet("kepler-22-b");
    expect(await getPlanetFormerNames(kepler22!.planet.id)).toEqual(["KOI-87.01"]);
  });

  it("lists the planets of a star from the inside out", async () => {
    const trappist = await getPlanet("trappist-1-b");
    const planets = await getPlanetsOfStar(trappist!.star.id);
    expect(planets.map((p) => p.name)).toEqual(
      ["b", "c", "d", "e", "f", "g", "h"].map((letter) => `TRAPPIST-1 ${letter}`),
    );
  });

  it("reads planets by slug in the order asked for", async () => {
    const planets = await getPlanetsBySlug(["earth", "missing", "proxima-cen-b"]);
    expect(planets.map((p) => p.slug)).toEqual(["earth", "proxima-cen-b"]);
    expect(await getPlanetsBySlug([])).toEqual([]);
  });

  it("records the withdrawal in the change history", async () => {
    const retracted = await getPlanet("retracted-1-b");
    expect(retracted?.planet.status).toBe("removed");
    expect(retracted?.planet.removedAt).toBeInstanceOf(Date);
    const changes = await getPlanetChanges(retracted!.planet.id);
    expect(changes).toContainEqual(
      expect.objectContaining({ field: "status", oldValue: "active", newValue: "removed" }),
    );
  });
});
