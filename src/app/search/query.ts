import { sql, type SQL } from "drizzle-orm";
import { measuredDensity, type PlanetSummary } from "@/app/planets/queries";
import type { StarSummary } from "@/app/stars/StarCard";
import { SOLAR_BODIES, type SolarBody } from "@/app/solar-system/bodies";
import { getDb } from "@/db/client";
import { searchKey } from "@/shared/slug";

/** Shorter queries would match almost every name. */
export const MIN_QUERY_LENGTH = 2;
/** Longer queries are cut off; no name in the catalogue comes close to this length. */
export const MAX_QUERY_LENGTH = 80;
/** How alike (0 to 1, pg_trgm word similarity) part of a name must be to count as similar. */
const SIMILARITY_THRESHOLD = 0.45;

export type SearchHit =
  | { kind: "planet"; planet: PlanetSummary }
  | { kind: "star"; star: StarSummary }
  | { kind: "body"; body: SolarBody };

export interface SearchResult {
  hits: SearchHit[];
  /** True when no name contains the query and the hits are only similar names. */
  similarOnly: boolean;
  /** True when there are more hits than `limit`. */
  hasMore: boolean;
}

type Row = {
  kind: "planet" | "star";
  slug: string;
  name: string;
  source: PlanetSummary["source"];
  status: PlanetSummary["status"];
  planet_class: PlanetSummary["planetClass"];
  climate_class: PlanetSummary["climateClass"];
  radius_earth: number | null;
  eq_temp_k: number | null;
  density_earth: number | null;
  orbital_period_days: number | null;
  star_name: string;
  star_teff_k: number | null;
  planet_count: number | null;
  rank: number;
  name_length: number;
};

/** A hit with the sort keys of `hitsQuery`, so that hits from the database and from code can be merged. */
type Ranked = { hit: SearchHit; rank: number; length: number; name: string };

/** Builds one query over planets and stars. `matches` selects the hits and `rank` orders them, lowest first. */
function hitsQuery(
  matches: (searchName: SQL) => SQL,
  rank: (searchName: SQL) => SQL,
  limit: number,
): SQL {
  const planetKey = sql`p.search_name`;
  const starKey = sql`s.search_name`;
  return sql`
    select * from (
      select 'planet' as kind, p.slug, p.name, p.source, p.status,
             p.planet_class, p.climate_class, p.radius_earth, p.eq_temp_k,
             ${measuredDensity(sql`p`)} as density_earth, p.orbital_period_days,
             s.name as star_name, s.teff_k as star_teff_k, null::int as planet_count,
             ${rank(planetKey)} as rank, length(p.search_name) as name_length
      from planets p
      join stars s on s.id = p.star_id
      where ${matches(planetKey)}
      union all
      select 'star', s.slug, s.name, s.source, 'active',
             null, null, null, null, null, null,
             s.name, s.teff_k, s.planet_count,
             ${rank(starKey)}, length(s.search_name)
      from stars s
      where ${matches(starKey)}
    ) hits
    order by rank, name_length, name
    limit ${limit}
  `;
}

function toHit(row: Row): SearchHit {
  if (row.kind === "star") {
    return {
      kind: "star",
      star: {
        slug: row.slug,
        name: row.name,
        teffK: row.star_teff_k,
        planetCount: row.planet_count ?? 0,
      },
    };
  }
  return {
    kind: "planet",
    planet: {
      slug: row.slug,
      name: row.name,
      source: row.source,
      status: row.status,
      planetClass: row.planet_class,
      climateClass: row.climate_class,
      radiusEarth: row.radius_earth,
      eqTempK: row.eq_temp_k,
      densityEarth: row.density_earth,
      orbitalPeriodDays: row.orbital_period_days,
      starName: row.star_name,
      starTeffK: row.star_teff_k,
    },
  };
}

/**
 * Searches planets, stars, moons and dwarf planets by name.
 *
 * The query is reduced to the same search key as the stored names, so "Kepler-22 b" and "kepler 22b" both
 * become `kepler22b`. Names containing the key rank in this order: the exact name, names starting with the key
 * as a whole word or number ("Kepler-22 b" for "kepler 22"), other prefixes ("Kepler-220"), then the rest,
 * shorter names first. Only when no name contains the key does the search fall back to similar names, which
 * catches typos such as "keplr 22".
 */
/**
 * Ranks the moons and dwarf planets, which live in code rather than in the database, by the same rules
 * as the direct matches of `search`. Returns only the bodies whose name contains the key.
 */
function matchBodies(key: string, wholeToken: RegExp): Ranked[] {
  return SOLAR_BODIES.flatMap((body) => {
    const name = searchKey(body.name);
    if (!name.includes(key)) return [];
    const rank = name === key ? 0 : wholeToken.test(name) ? 1 : name.startsWith(key) ? 2 : 3;
    return [{ hit: { kind: "body", body } as const, rank, length: name.length, name: body.name }];
  });
}

function byRank(a: Ranked, b: Ranked): number {
  return a.rank - b.rank || a.length - b.length || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

export async function search(query: string, limit: number): Promise<SearchResult> {
  const key = searchKey(query.slice(0, MAX_QUERY_LENGTH));
  if (key.length < MIN_QUERY_LENGTH) {
    return { hits: [], similarOnly: false, hasMore: false };
  }
  const db = getDb();
  // Fetching one extra row tells us whether there are more hits.
  const fetchLimit = limit + 1;

  // The key contains only a-z and 0-9, so it needs no escaping for LIKE or the regular expression.
  // The expression rejects names where the key stops in the middle of a number or word: after
  // "kepler22" must come a letter or the end, not another digit.
  const wholeToken = `^${key}(${/[0-9]$/.test(key) ? "[a-z]" : "[0-9]"}|$)`;
  const direct = await db.execute<Row>(
    hitsQuery(
      (name) => sql`${name} like '%' || ${key} || '%'`,
      (name) => sql`case
        when ${name} = ${key} then 0
        when ${name} ~ ${wholeToken} then 1
        when ${name} like ${key} || '%' then 2
        else 3
      end`,
      fetchLimit,
    ),
  );
  const merged = [
    ...direct.map((row) => ({ hit: toHit(row), rank: Number(row.rank), length: Number(row.name_length), name: row.name })),
    ...matchBodies(key, new RegExp(wholeToken)),
  ].sort(byRank);
  if (merged.length > 0) {
    return {
      hits: merged.slice(0, limit).map((entry) => entry.hit),
      similarOnly: false,
      hasMore: merged.length > limit,
    };
  }

  // Both functions compare pg_trgm trigrams. word_similarity finds the part of a name that resembles the key
  // ("proxma" in "Proxima Cen b"), while similarity compares whole names to rank the closest first.
  const similar = await db.execute<Row>(
    hitsQuery(
      (name) => sql`word_similarity(${key}, ${name}) >= ${SIMILARITY_THRESHOLD}`,
      (name) => sql`-similarity(${key}, ${name})`,
      fetchLimit,
    ),
  );
  return {
    hits: similar.slice(0, limit).map(toHit),
    similarOnly: similar.length > 0,
    hasMore: similar.length > limit,
  };
}
