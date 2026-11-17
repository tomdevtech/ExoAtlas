import { desc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findPlanetSlugByAlias, getPlanet, getPlanetChanges } from "@/app/planets/queries";
import { getDb } from "@/db/client";
import { planets, syncRuns } from "@/db/schema";
import { FIXTURE_ROWS_AFTER_RETRACTION } from "@tests/support/catalog";
import { prepareTestDatabase, testDatabaseUrl } from "@tests/support/db";
import { runSync } from "@/app/sync/run";

/** Returns a fresh copy of the catalogue as the database holds it after seeding. */
const current = () => FIXTURE_ROWS_AFTER_RETRACTION.map((row) => ({ ...row }));

/** Stubs fetch so that NASA responds with `rows`. */
function nasaAnswers(rows: unknown[]) {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify(rows)));
}

async function lastRun() {
  const [run] = await getDb().select().from(syncRuns).orderBy(desc(syncRuns.id)).limit(1);
  return run;
}

async function planetCount() {
  return (await getDb().select({ id: planets.id }).from(planets)).length;
}

describe("runSync against the database", () => {
  // These tests change the data, so each one starts from the known state, which
  // also leaves that state for the test files that run afterwards.
  beforeEach(() => prepareTestDatabase(testDatabaseUrl()));
  afterEach(() => vi.unstubAllGlobals());
  afterAll(() => prepareTestDatabase(testDatabaseUrl()));

  it("changes nothing when NASA sends the same catalogue again", async () => {
    nasaAnswers(current());
    const counts = await runSync({ force: true });
    expect(counts).toEqual({
      added: 0,
      updated: 0,
      unchanged: FIXTURE_ROWS_AFTER_RETRACTION.length,
      removed: 0,
      renamed: 0,
    });
    expect((await lastRun()).status).toBe("success");
  });

  it("records changed values in the history", async () => {
    const rows = current();
    const kepler22 = rows.find((row) => row.pl_name === "Kepler-22 b")!;
    kepler22.pl_rade = 2.4;
    nasaAnswers(rows);

    const counts = await runSync({ force: true });
    expect(counts.updated).toBe(1);

    const found = await getPlanet("kepler-22-b");
    expect(found?.planet.radiusEarth).toBe(2.4);
    const changes = await getPlanetChanges(found!.planet.id);
    expect(changes).toContainEqual(
      expect.objectContaining({ field: "radiusEarth", oldValue: "2.1", newValue: "2.4" }),
    );
  });

  it("adds new planets", async () => {
    const rows = current();
    const template = rows.find((row) => row.pl_name === "K2-18 b")!;
    rows.push({ ...template, pl_name: "K2-18 c", pl_orbper: 8.96, pl_orbsmax: 0.06 });
    nasaAnswers(rows);

    const counts = await runSync({ force: true });
    expect(counts.added).toBe(1);
    expect((await getPlanet("k2-18-c"))?.star.planetCount).toBe(2);
  });

  it("treats a vanished name with a new one at the same place as a rename", async () => {
    const rows = current();
    const k218 = rows.find((row) => row.pl_name === "K2-18 b")!;
    // The same star and orbital period identify the same planet under a new name.
    k218.pl_name = "K2-18 d";
    nasaAnswers(rows);

    const counts = await runSync({ force: true });
    expect(counts.renamed).toBe(1);
    expect(counts.added).toBe(0);
    // The old route must lead to the new one.
    expect(await findPlanetSlugByAlias("k2-18-b")).toBe("k2-18-d");
    expect((await getPlanet("k2-18-d"))?.planet.name).toBe("K2-18 d");
  });

  it("refuses an implausible catalogue without --force and changes nothing", async () => {
    const before = await planetCount();
    nasaAnswers(current().slice(0, 3));

    await expect(runSync()).rejects.toThrow(/Stopped without changing anything/);
    expect(await planetCount()).toBe(before);
    expect((await getPlanet("trappist-1-e"))?.planet.status).toBe("active");
    const run = await lastRun();
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/only 3 planets/);
  });

  it("stops and records the reason when NASA answers with an error", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response("<VOTABLE><INFO>Service unavailable</INFO></VOTABLE>", { status: 503 }),
    );
    await expect(runSync({ force: true })).rejects.toThrow(/status 503: Service unavailable/);
    expect((await lastRun()).status).toBe("failed");
  });

  it("stops when the answer is not JSON or not a list", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html>maintenance</html>"));
    await expect(runSync({ force: true })).rejects.toThrow(/not JSON/);
    nasaAnswers({ rows: [] } as unknown as unknown[]);
    await expect(runSync({ force: true })).rejects.toThrow(/not a list/);
  });

  it("leaves the solar system alone", async () => {
    nasaAnswers(current());
    await runSync({ force: true });
    const earth = await getPlanet("earth");
    expect(earth?.planet.source).toBe("sol");
    expect(earth?.planet.status).toBe("active");
    const [jupiter] = await getDb().select().from(planets).where(eq(planets.slug, "jupiter"));
    expect(jupiter.status).toBe("active");
  });
});
