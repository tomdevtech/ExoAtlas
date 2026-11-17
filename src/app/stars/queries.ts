import { asc, eq } from "drizzle-orm";
import { cache } from "react";
import { getDb } from "@/db/client";
import { starAliases, stars } from "@/db/schema";
import { isSlug } from "@/shared/slug";

/**
 * Returns a star by slug, or null. It is wrapped in `cache` because the page metadata and the page body both
 * request it within one request.
 */
export const getStar = cache(async (slug: string) => {
  if (!isSlug(slug)) return null;
  const [star] = await getDb().select().from(stars).where(eq(stars.slug, slug)).limit(1);
  return star ?? null;
});

/** Returns the current slug of a star that used to be reachable under `slug`. */
export async function findStarSlugByAlias(slug: string): Promise<string | null> {
  if (!isSlug(slug)) return null;
  const [row] = await getDb()
    .select({ slug: stars.slug })
    .from(starAliases)
    .innerJoin(stars, eq(stars.id, starAliases.starId))
    .where(eq(starAliases.slug, slug))
    .limit(1);
  return row?.slug ?? null;
}

/** Returns the former names of a star, oldest first. */
export async function getStarFormerNames(starId: number): Promise<string[]> {
  const rows = await getDb()
    .select({ name: starAliases.name })
    .from(starAliases)
    .where(eq(starAliases.starId, starId))
    .orderBy(asc(starAliases.createdAt));
  return rows.map((row) => row.name);
}
