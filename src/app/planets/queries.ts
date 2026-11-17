import { and, asc, desc, eq, inArray, like, or, sql, type SQL } from "drizzle-orm";
import { cache } from "react";
import { getDb } from "@/db/client";
import { planetAliases, planetChanges, planets, stars } from "@/db/schema";
import { isSlug, searchKey } from "@/shared/slug";
import { PAGE_SIZE, clampPage, type ListSort } from "./paging";

/**
 * SQL expression for the density relative to Earth, set only where NASA measured both mass and radius,
 * because a density derived from the radius alone says nothing about composition. `table` is the alias
 * of the planets table in the query.
 */
export function measuredDensity(table: SQL = sql`${planets}`): SQL<number | null> {
  return sql<number | null>`case
    when ${table}.mass_earth > 0 and ${table}.radius_earth > 0
      and not ${table}.mass_calculated and not ${table}.mass_is_minimum and not ${table}.radius_calculated
    then ${table}.mass_earth / power(${table}.radius_earth, 3)
  end`;
}

/** The columns a list entry and its thumbnail need. */
export const planetSummaryColumns = {
  slug: planets.slug,
  name: planets.name,
  source: planets.source,
  status: planets.status,
  planetClass: planets.planetClass,
  climateClass: planets.climateClass,
  radiusEarth: planets.radiusEarth,
  eqTempK: planets.eqTempK,
  densityEarth: measuredDensity(),
  orbitalPeriodDays: planets.orbitalPeriodDays,
  starName: stars.name,
  starTeffK: stars.teffK,
};

export interface PlanetSummary {
  slug: string;
  name: string;
  source: "nasa" | "sol";
  status: "active" | "removed";
  planetClass: "rocky" | "super_earth" | "neptune_like" | "gas_giant" | null;
  climateClass: "frozen" | "cold" | "temperate" | "hot" | "scorching" | null;
  radiusEarth: number | null;
  eqTempK: number | null;
  /** Relative to Earth, and only set when mass and radius were both measured. */
  densityEarth: number | null;
  orbitalPeriodDays: number | null;
  starName: string;
  starTeffK: number | null;
}

/**
 * Returns a planet with its star, or null. It is wrapped in `cache` because the page metadata and the
 * page body both request it within one request.
 */
export const getPlanet = cache(async (slug: string) => {
  if (!isSlug(slug)) return null;
  const [row] = await getDb()
    .select({ planet: planets, star: stars, densityEarth: measuredDensity() })
    .from(planets)
    .innerJoin(stars, eq(stars.id, planets.starId))
    .where(eq(planets.slug, slug))
    .limit(1);
  return row ?? null;
});

/** Returns the current slug of a planet that used to be reachable under `slug`. */
export async function findPlanetSlugByAlias(slug: string): Promise<string | null> {
  if (!isSlug(slug)) return null;
  const [row] = await getDb()
    .select({ slug: planets.slug })
    .from(planetAliases)
    .innerJoin(planets, eq(planets.id, planetAliases.planetId))
    .where(eq(planetAliases.slug, slug))
    .limit(1);
  return row?.slug ?? null;
}

/** Returns all planets of a star from the inside out, including removed ones. */
export async function getPlanetsOfStar(starId: number): Promise<PlanetSummary[]> {
  return getDb()
    .select(planetSummaryColumns)
    .from(planets)
    .innerJoin(stars, eq(stars.id, planets.starId))
    .where(eq(planets.starId, starId))
    .orderBy(asc(planets.orbitalPeriodDays), asc(planets.semiMajorAxisAu), asc(planets.name));
}

/** Returns planets in the order of `slugs`. Slugs that do not exist are skipped. */
export async function getPlanetsBySlug(slugs: string[]): Promise<PlanetSummary[]> {
  if (slugs.length === 0) return [];
  const rows = await getDb()
    .select(planetSummaryColumns)
    .from(planets)
    .innerJoin(stars, eq(stars.id, planets.starId))
    .where(inArray(planets.slug, slugs));
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  return slugs.flatMap((slug) => bySlug.get(slug) ?? []);
}

/** Longer filter texts are cut off; no name in the catalogue comes close to this length. */
const MAX_FILTER_LENGTH = 80;

/** A row of the planet list: the summary plus the discovery year the list can sort by. */
export interface PlanetListEntry extends PlanetSummary {
  /** Null for the six planets that were known before anybody kept records. */
  discoveryYear: number | null;
}

export interface PlanetListPage {
  planets: PlanetListEntry[];
  /** Number of planets matching the filter across all pages. */
  total: number;
  /** The page actually read. It differs from the requested page when that page does not exist. */
  page: number;
}

/**
 * Returns one page of the active planets.
 *
 * `sort` orders by name or by discovery year, newest first. The catalogue records only the year, so planets
 * of the same year are ordered by name, and planets without a year come last.
 *
 * `filter` matches the planet or star name. It is reduced to the `search_name` form, so "kepler 22" and
 * "Kepler-22" find the same planets.
 */
export async function listPlanets(
  filter: string,
  page: number,
  sort: ListSort = "name",
): Promise<PlanetListPage> {
  const trimmed = filter.trim().slice(0, MAX_FILTER_LENGTH);
  const key = searchKey(trimmed);
  // A filter without a single letter or digit, like "?", matches no name.
  if (trimmed !== "" && key === "") return { planets: [], total: 0, page: 1 };

  const db = getDb();
  const active = eq(planets.status, "active");
  // The key holds only a-z and 0-9, so it needs no escaping for LIKE.
  const where =
    key === ""
      ? active
      : and(
          active,
          or(like(planets.searchName, `%${key}%`), like(stars.searchName, `%${key}%`)),
        );

  const [{ total }] = await db
    .select({ total: sql<number>`cast(count(*) as int)` })
    .from(planets)
    .innerJoin(stars, eq(stars.id, planets.starId))
    .where(where);

  // Digits sort as numbers: "Kepler-9 b" before "Kepler-10 b" (drizzle/0002_natural_order.sql).
  const byName = [sql`${planets.name} collate "natural_name"`, asc(planets.id)];
  const current = clampPage(page, total);
  const rows = await db
    .select({ ...planetSummaryColumns, discoveryYear: planets.discoveryYear })
    .from(planets)
    .innerJoin(stars, eq(stars.id, planets.starId))
    .where(where)
    .orderBy(
      ...(sort === "discovery"
        ? [sql`${planets.discoveryYear} desc nulls last`, ...byName]
        : byName),
    )
    .limit(PAGE_SIZE)
    .offset((current - 1) * PAGE_SIZE);

  return { planets: rows, total, page: current };
}

/** Returns the former names of a planet, oldest first. */
export async function getPlanetFormerNames(planetId: number): Promise<string[]> {
  const rows = await getDb()
    .select({ name: planetAliases.name })
    .from(planetAliases)
    .where(eq(planetAliases.planetId, planetId))
    .orderBy(asc(planetAliases.createdAt));
  return rows.map((row) => row.name);
}

/** One recorded change of a planet value. */
export type PlanetChange = Awaited<ReturnType<typeof getPlanetChanges>>[number];

/** The latest recorded changes of a planet, newest first. */
export async function getPlanetChanges(planetId: number, limit = 30) {
  return getDb()
    .select({
      id: planetChanges.id,
      field: planetChanges.field,
      oldValue: planetChanges.oldValue,
      newValue: planetChanges.newValue,
      changedAt: planetChanges.changedAt,
    })
    .from(planetChanges)
    .where(eq(planetChanges.planetId, planetId))
    .orderBy(desc(planetChanges.changedAt), desc(planetChanges.id))
    .limit(limit);
}
