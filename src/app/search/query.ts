import { sql, type SQL } from "drizzle-orm";
import { measuredDensity, type PlanetSummary } from "@/app/planets/queries";
import type { StarSummary } from "@/app/stars/StarCard";
import { getDb } from "@/db/client";
import { searchKey } from "@/shared/slug";

/** Shorter queries would match almost every name. */
export const MIN_QUERY_LENGTH = 2;
/** Longer queries are cut off. No name in the catalogue comes close to this. */
export const MAX_QUERY_LENGTH = 80;
/** How alike a part of a name must be to count as "similar", from 0 to 1. */
const SIMILARITY_THRESHOLD = 0.45;

export type SearchHit =
  | { kind: "planet"; planet: PlanetSummary }
  | { kind: "star"; star: StarSummary };

export interface SearchResult {
  hits: SearchHit[];
  /** No name contains the query. The hits are names that are merely similar. */
  similarOnly: boolean;
  /** There are more hits than `limit`. */
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
};

/**
 * Planets and stars in one list. `matches` decides which names are hits,
 * `rank` sorts them: the smaller the number, the further up.
 */
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
 * Searches planets and stars by name.
 *
 * The query is reduced to the same search key as the stored names ("Kepler-22
 * b", "kepler 22b" and "KEPLER22B" all become `kepler22b`), so spelling
 * details do not matter. Names that contain the key win, in this order: the
 * exact name, names that start with the key as a whole word or number
 * ("Kepler-22 b" for "kepler 22"), other names that start with it
 * ("Kepler-220"), then the rest. Shorter names come first within each group.
 * Only when no name contains the key does the search fall back to similar
 * names, which catches typos such as "keplr 22".
 */
export async function search(query: string, limit: number): Promise<SearchResult> {
  const key = searchKey(query.slice(0, MAX_QUERY_LENGTH));
  if (key.length < MIN_QUERY_LENGTH) {
    return { hits: [], similarOnly: false, hasMore: false };
  }
  const db = getDb();
  // One row more than asked for tells us whether there are more hits.
  const fetchLimit = limit + 1;

  // The key only contains a-z and 0-9, so it needs no escaping for LIKE or for
  // the regular expression. The expression matches names in which the key is
  // not cut off in the middle of a number or a word: after "kepler22" comes a
  // letter or the end, not another digit.
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
  if (direct.length > 0) {
    return {
      hits: direct.slice(0, limit).map(toHit),
      similarOnly: false,
      hasMore: direct.length > limit,
    };
  }

  // Both functions compare trigrams (pg_trgm). word_similarity looks for the
  // part of a name that resembles the key, which also finds "proxma" in
  // "Proxima Cen b". similarity compares the whole name and puts the closest
  // names first.
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
