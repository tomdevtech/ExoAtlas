import { describe, expect, it } from "vitest";
import { buildCatalog, type Catalog } from "@/app/sync/nasa";
import { implausible, planSync, type ExistingPlanet, type ExistingStar } from "@/app/sync/plan";
import { nasaRow } from "@tests/support/sync-fixtures";

/** Pretends that a catalogue is already stored in the database. */
function stored(catalog: Catalog) {
  const stars: ExistingStar[] = catalog.stars.map((star, i) => ({
    ...star,
    id: i + 1,
    slug: `star-${i + 1}`,
  }));
  const starId = new Map(stars.map((s) => [s.name, s.id]));
  const planets: ExistingPlanet[] = catalog.planets.map((planet, i) => ({
    ...planet,
    id: i + 1,
    slug: `planet-${i + 1}`,
    starId: starId.get(planet.hostName)!,
    status: "active",
  }));
  return { stars, planets };
}

const before = buildCatalog([
  nasaRow({ pl_name: "A b", hostname: "A", ra: 10, dec: 10, pl_orbper: 5 }),
  nasaRow({ pl_name: "A c", hostname: "A", ra: 10, dec: 10, pl_orbper: 12 }),
  nasaRow({ pl_name: "B b", hostname: "B", ra: 50, dec: -30, pl_orbper: 3 }),
]);

describe("planSync", () => {
  it("inserts everything into an empty database", () => {
    const plan = planSync({ stars: [], planets: [] }, before);
    expect(plan.starInserts.map((s) => s.slug)).toEqual(["a", "b"]);
    expect(plan.planetInserts.map((p) => p.slug)).toEqual(["a-b", "a-c", "b-b"]);
    expect(plan.counts).toMatchObject({ added: 3, updated: 0, removed: 0 });
  });

  it("writes nothing when nothing has changed", () => {
    const plan = planSync(stored(before), before);
    expect(plan.starInserts).toHaveLength(0);
    expect(plan.starUpdates).toHaveLength(0);
    expect(plan.planetInserts).toHaveLength(0);
    expect(plan.planetUpdates).toHaveLength(0);
    expect(plan.planetRemovals).toHaveLength(0);
    expect(plan.counts).toMatchObject({ added: 0, updated: 0, unchanged: 3 });
  });

  it("records changed values with the old and the new value", () => {
    const after = buildCatalog([
      nasaRow({ pl_name: "A b", hostname: "A", ra: 10, dec: 10, pl_orbper: 5, pl_rade: 1.4 }),
      nasaRow({ pl_name: "A c", hostname: "A", ra: 10, dec: 10, pl_orbper: 12 }),
      nasaRow({ pl_name: "B b", hostname: "B", ra: 50, dec: -30, pl_orbper: 3 }),
    ]);
    const plan = planSync(stored(before), after);
    expect(plan.counts).toMatchObject({ updated: 1, unchanged: 2 });
    expect(plan.planetUpdates).toHaveLength(1);
    expect(plan.planetUpdates[0].changes).toEqual([
      { field: "radiusEarth", oldValue: "1.1", newValue: "1.4" },
    ]);
    expect(plan.planetUpdates[0].planet.planetClass).toBe("super_earth");
  });

  it("marks vanished planets as removed", () => {
    const after = buildCatalog([
      nasaRow({ pl_name: "A b", hostname: "A", ra: 10, dec: 10, pl_orbper: 5 }),
      nasaRow({ pl_name: "B b", hostname: "B", ra: 50, dec: -30, pl_orbper: 3 }),
    ]);
    const db = stored(before);
    const plan = planSync(db, after);
    const removed = db.planets.find((p) => p.name === "A c")!;
    expect(plan.planetRemovals).toEqual([removed.id]);
    expect(plan.counts.removed).toBe(1);
  });

  it("restores a removed planet when it shows up again", () => {
    const db = stored(before);
    db.planets[0].status = "removed";
    const plan = planSync(db, before);
    expect(plan.planetInserts).toHaveLength(0);
    expect(plan.planetUpdates).toHaveLength(1);
    expect(plan.planetUpdates[0].changes).toEqual([
      { field: "status", oldValue: "removed", newValue: "active" },
    ]);
    expect(plan.counts).toMatchObject({ added: 0, updated: 1, unchanged: 2 });
  });

  it("recognises a renamed star and its planet by position and orbital period", () => {
    const after = buildCatalog([
      nasaRow({ pl_name: "A b", hostname: "A", ra: 10, dec: 10, pl_orbper: 5 }),
      nasaRow({ pl_name: "A c", hostname: "A", ra: 10, dec: 10, pl_orbper: 12 }),
      nasaRow({ pl_name: "New b", hostname: "New", ra: 50.0001, dec: -30, pl_orbper: 3.001 }),
    ]);
    const db = stored(before);
    const plan = planSync(db, after);
    const oldStar = db.stars.find((s) => s.name === "B")!;
    const oldPlanet = db.planets.find((p) => p.name === "B b")!;

    expect(plan.starInserts).toHaveLength(0);
    expect(plan.starUpdates).toHaveLength(1);
    expect(plan.starUpdates[0]).toMatchObject({
      id: oldStar.id,
      slug: "new",
      rename: { oldName: "B", oldSlug: oldStar.slug },
    });

    expect(plan.planetInserts).toHaveLength(0);
    expect(plan.planetRemovals).toHaveLength(0);
    expect(plan.planetUpdates).toHaveLength(1);
    expect(plan.planetUpdates[0]).toMatchObject({
      id: oldPlanet.id,
      slug: "new-b",
      rename: { oldName: "B b", oldSlug: oldPlanet.slug },
    });
    expect(plan.planetUpdates[0].changes).toContainEqual({
      field: "name",
      oldValue: "B b",
      newValue: "New b",
    });
    expect(plan.counts).toMatchObject({
      added: 0,
      updated: 1,
      unchanged: 2,
      removed: 0,
      renamed: 1,
    });
  });

  it("does not take a new star at a different place for a rename", () => {
    const after = buildCatalog([
      nasaRow({ pl_name: "A b", hostname: "A", ra: 10, dec: 10, pl_orbper: 5 }),
      nasaRow({ pl_name: "A c", hostname: "A", ra: 10, dec: 10, pl_orbper: 12 }),
      nasaRow({ pl_name: "New b", hostname: "New", ra: 51, dec: -30, pl_orbper: 3 }),
    ]);
    const plan = planSync(stored(before), after);
    expect(plan.starInserts).toHaveLength(1);
    expect(plan.planetInserts).toHaveLength(1);
    expect(plan.planetRemovals).toHaveLength(1);
    expect(plan.counts.renamed).toBe(0);
  });

  it("never assigns a slug twice", () => {
    const plan = planSync(
      { stars: [], planets: [], reservedSlugs: { stars: ["a"], planets: ["a-b"] } },
      before,
    );
    expect(plan.starInserts.map((s) => s.slug)).toEqual(["a-2", "b"]);
    expect(plan.planetInserts.map((p) => p.slug)).toEqual(["a-b-2", "a-c", "b-b"]);
  });
});

describe("implausible", () => {
  const empty = planSync({ stars: [], planets: [] }, before);

  it("lets a normal run pass", () => {
    expect(implausible(empty, 6400, 6470)).toBeNull();
    expect(implausible(empty, 0, 6470)).toBeNull();
  });

  it("stops when suspiciously few rows arrive", () => {
    expect(implausible(empty, 0, 12)).toMatch(/only 12/);
    expect(implausible(empty, 6400, 5000)).toMatch(/5000/);
  });

  it("stops when suspiciously many planets would be removed", () => {
    const many = { ...empty, counts: { ...empty.counts, removed: 500 } };
    expect(implausible(many, 6400, 6470)).toMatch(/500/);
  });
});
