import { eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  planetAliases,
  planetChanges,
  planets,
  starAliases,
  stars,
  syncRuns,
} from "@/db/schema";
import { searchKey } from "@/shared/slug";
import { fetchCatalog, type CatalogPlanet, type CatalogStar } from "./nasa";
import { implausible, planSync, type SyncPlan } from "./plan";

export interface SyncOptions {
  /** Write even when the response from NASA looks implausible. */
  force?: boolean;
  /** Receives progress messages. */
  log?: (message: string) => void;
}

function chunks<T>(items: T[], size = 500): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

function starRow(star: CatalogStar, slug: string) {
  return {
    ...star,
    slug,
    searchName: searchKey(star.name),
    source: "nasa" as const,
    updatedAt: new Date(),
  };
}

function planetRow(planet: CatalogPlanet, slug: string, starId: number) {
  // hostName is not a column: the planet points to its star through starId.
  const { hostName, ...values } = planet;
  void hostName;
  return {
    ...values,
    slug,
    searchName: searchKey(planet.name),
    starId,
    source: "nasa" as const,
    status: "active" as const,
    removedAt: null,
    updatedAt: new Date(),
  };
}

/** Fetches the catalogue, plans the changes and writes them in one transaction. */
async function fetchPlanApply(runId: number, { force = false, log = () => {} }: SyncOptions) {
  const db = getDb();

  log("Downloading the catalogue from NASA …");
  const catalog = await fetchCatalog();
  log(`  ${catalog.planets.length} planets around ${catalog.stars.length} stars`);

  const existingStars = await db.select().from(stars).where(eq(stars.source, "nasa"));
  const existingPlanets = await db.select().from(planets).where(eq(planets.source, "nasa"));
  // Slugs of all rows, including the solar system, so no slug is assigned twice.
  const reservedSlugs = {
    stars: (await db.select({ slug: stars.slug }).from(stars)).map((r) => r.slug),
    planets: (await db.select({ slug: planets.slug }).from(planets)).map((r) => r.slug),
  };

  const plan = planSync({ stars: existingStars, planets: existingPlanets, reservedSlugs }, catalog);

  const activeBefore = existingPlanets.filter((p) => p.status === "active").length;
  const problem = implausible(plan, activeBefore, catalog.planets.length);
  if (problem && !force) {
    throw new Error(`${problem} Stopped without changing anything. Use --force to override.`);
  }

  // All or nothing: when one step fails, the previous state stays in place.
  await db.transaction(async (tx) => {
    for (const batch of chunks(plan.starInserts)) {
      await tx.insert(stars).values(batch.map((s) => starRow(s.star, s.slug)));
    }
    for (const update of plan.starUpdates) {
      await tx.update(stars).set(starRow(update.star, update.slug)).where(eq(stars.id, update.id));
      if (update.rename) {
        await tx
          .insert(starAliases)
          .values({ starId: update.id, slug: update.rename.oldSlug, name: update.rename.oldName })
          .onConflictDoNothing();
      }
    }

    const starIds = new Map(
      (
        await tx
          .select({ id: stars.id, name: stars.name })
          .from(stars)
          .where(eq(stars.source, "nasa"))
      ).map((s) => [s.name, s.id]),
    );
    const starIdOf = (planet: CatalogPlanet) => {
      const id = starIds.get(planet.hostName);
      if (id === undefined) {
        throw new Error(`No star "${planet.hostName}" for ${planet.name}.`);
      }
      return id;
    };

    for (const batch of chunks(plan.planetInserts)) {
      await tx
        .insert(planets)
        .values(batch.map((p) => planetRow(p.planet, p.slug, starIdOf(p.planet))));
    }

    const changeRows: (typeof planetChanges.$inferInsert)[] = [];
    for (const update of plan.planetUpdates) {
      await tx
        .update(planets)
        .set(planetRow(update.planet, update.slug, starIdOf(update.planet)))
        .where(eq(planets.id, update.id));
      if (update.rename) {
        await tx
          .insert(planetAliases)
          .values({
            planetId: update.id,
            slug: update.rename.oldSlug,
            name: update.rename.oldName,
          })
          .onConflictDoNothing();
      }
      for (const change of update.changes) {
        changeRows.push({ planetId: update.id, syncRunId: runId, ...change });
      }
    }

    for (const batch of chunks(plan.planetRemovals)) {
      await tx
        .update(planets)
        .set({ status: "removed", removedAt: new Date(), updatedAt: new Date() })
        .where(inArray(planets.id, batch));
      for (const planetId of batch) {
        changeRows.push({
          planetId,
          syncRunId: runId,
          field: "status",
          oldValue: "active",
          newValue: "removed",
        });
      }
    }

    for (const batch of chunks(changeRows)) {
      await tx.insert(planetChanges).values(batch);
    }

    await tx.execute(sql`
      update stars set planet_count = (
        select count(*) from planets
        where planets.star_id = stars.id and planets.status = 'active'
      )
    `);
  });

  return { rowsFetched: catalog.planets.length, counts: plan.counts };
}

/**
 * Runs one sync with the NASA Exoplanet Archive and throws if it fails. The run is recorded in `sync_runs`
 * outside the transaction, so a failed run leaves a trace too.
 */
export async function runSync(options: SyncOptions = {}): Promise<SyncPlan["counts"]> {
  const db = getDb();
  const [{ id: runId }] = await db.insert(syncRuns).values({}).returning({ id: syncRuns.id });
  try {
    const { rowsFetched, counts } = await fetchPlanApply(runId, options);
    await db
      .update(syncRuns)
      .set({ status: "success", finishedAt: new Date(), rowsFetched, ...counts })
      .where(eq(syncRuns.id, runId));
    return counts;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(syncRuns)
      .set({ status: "failed", finishedAt: new Date(), error: message })
      .where(eq(syncRuns.id, runId));
    throw error;
  }
}
