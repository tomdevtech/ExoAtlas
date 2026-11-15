import { TRACKED_FIELDS, type PlanetData } from "@/app/planets/measurements";
import { separationArcsec } from "@/app/stars/coordinates";
import { uniqueSlug } from "@/shared/slug";
import {
  STAR_FIELDS,
  type Catalog,
  type CatalogPlanet,
  type CatalogStar,
  type StarData,
} from "./nasa";

export interface ExistingStar extends StarData {
  id: number;
  name: string;
  slug: string;
}

export interface ExistingPlanet extends PlanetData {
  id: number;
  name: string;
  slug: string;
  starId: number;
  status: "active" | "removed";
  dataHash: string;
  planetClass: string | null;
  climateClass: string | null;
}

export interface FieldChange {
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

export interface Rename {
  oldName: string;
  oldSlug: string;
}

/** Everything one sync run has to write. */
export interface SyncPlan {
  starInserts: { star: CatalogStar; slug: string }[];
  starUpdates: { id: number; star: CatalogStar; slug: string; rename?: Rename }[];
  planetInserts: { planet: CatalogPlanet; slug: string }[];
  planetUpdates: {
    id: number;
    planet: CatalogPlanet;
    slug: string;
    rename?: Rename;
    changes: FieldChange[];
  }[];
  planetRemovals: number[];
  counts: {
    added: number;
    updated: number;
    unchanged: number;
    removed: number;
    renamed: number;
  };
}

/** Two stars count as the same when they are this close in the sky. */
const SAME_STAR_ARCSEC = 5;
/** Two orbital periods count as equal when they differ by less than 1 %. */
const SAME_PERIOD_TOLERANCE = 0.01;

function show(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function lastWord(name: string): string {
  return name.trim().split(/\s+/).at(-1) ?? "";
}

function samePlanet(old: ExistingPlanet, incoming: CatalogPlanet): boolean {
  const a = old.orbitalPeriodDays;
  const b = incoming.orbitalPeriodDays;
  if (a !== null && b !== null && a > 0 && b > 0) {
    if (Math.abs(a - b) / Math.max(a, b) < SAME_PERIOD_TOLERANCE) return true;
  }
  // The letter at the end ("b", "c" …) survives a rename.
  return lastWord(old.name) === lastWord(incoming.name);
}

/**
 * Compares what is stored with the new catalogue and decides what to write.
 * The function does not touch the database, so it can be tested without one.
 *
 * NASA assigns no permanent identifier. When a name vanishes and a new one
 * appears at the same place in the same run, we treat that as a rename: the
 * entry keeps its id and its history.
 */
export function planSync(
  existing: {
    stars: ExistingStar[];
    planets: ExistingPlanet[];
    /** Further slugs that are taken, for example those of the solar system. */
    reservedSlugs?: { stars: string[]; planets: string[] };
  },
  incoming: Catalog,
): SyncPlan {
  const plan: SyncPlan = {
    starInserts: [],
    starUpdates: [],
    planetInserts: [],
    planetUpdates: [],
    planetRemovals: [],
    counts: { added: 0, updated: 0, unchanged: 0, removed: 0, renamed: 0 },
  };

  // --- Stars ----------------------------------------------------------------

  const starSlugs = new Set([
    ...existing.stars.map((s) => s.slug),
    ...(existing.reservedSlugs?.stars ?? []),
  ]);
  const incomingStarNames = new Set(incoming.stars.map((s) => s.name));
  const starsByName = new Map(existing.stars.map((s) => [s.name, s]));
  const starsById = new Map(existing.stars.map((s) => [s.id, s]));
  const vanishedStars = existing.stars.filter((s) => !incomingStarNames.has(s.name));
  const claimedStars = new Set<number>();
  /** Name in the new catalogue → id of the stored star. New stars are missing here. */
  const starIdByIncomingName = new Map<string, number>();

  for (const star of incoming.stars) {
    let match = starsByName.get(star.name);
    let rename: Rename | undefined;

    if (!match && star.ra !== null && star.dec !== null) {
      const position = { ra: star.ra, dec: star.dec };
      const candidates = vanishedStars.filter(
        (old) =>
          !claimedStars.has(old.id) &&
          old.ra !== null &&
          old.dec !== null &&
          separationArcsec({ ra: old.ra, dec: old.dec }, position) < SAME_STAR_ARCSEC,
      );
      if (candidates.length === 1) {
        match = candidates[0];
        claimedStars.add(match.id);
        rename = { oldName: match.name, oldSlug: match.slug };
      }
    }

    if (!match) {
      plan.starInserts.push({ star, slug: uniqueSlug(star.name, starSlugs) });
      continue;
    }

    starIdByIncomingName.set(star.name, match.id);
    const current = match;
    const changed = STAR_FIELDS.some((field) => current[field] !== star[field]);
    if (rename || changed) {
      plan.starUpdates.push({
        id: match.id,
        star,
        slug: rename ? uniqueSlug(star.name, starSlugs) : match.slug,
        rename,
      });
    }
  }

  // --- Planets --------------------------------------------------------------

  const planetSlugs = new Set([
    ...existing.planets.map((p) => p.slug),
    ...(existing.reservedSlugs?.planets ?? []),
  ]);
  const incomingPlanetNames = new Set(incoming.planets.map((p) => p.name));
  const planetsByName = new Map(existing.planets.map((p) => [p.name, p]));
  const vanishedPlanets = existing.planets.filter(
    (p) => p.status === "active" && !incomingPlanetNames.has(p.name),
  );
  const claimedPlanets = new Set<number>();

  for (const planet of incoming.planets) {
    const starId = starIdByIncomingName.get(planet.hostName);
    let match = planetsByName.get(planet.name);
    let rename: Rename | undefined;

    if (!match && starId !== undefined) {
      const candidates = vanishedPlanets.filter(
        (old) => old.starId === starId && !claimedPlanets.has(old.id) && samePlanet(old, planet),
      );
      if (candidates.length === 1) {
        match = candidates[0];
        claimedPlanets.add(match.id);
        rename = { oldName: match.name, oldSlug: match.slug };
      }
    }

    if (!match) {
      plan.planetInserts.push({ planet, slug: uniqueSlug(planet.name, planetSlugs) });
      plan.counts.added++;
      continue;
    }

    const current = match;
    const changes: FieldChange[] = [];
    if (rename) {
      changes.push({ field: "name", oldValue: rename.oldName, newValue: planet.name });
      plan.counts.renamed++;
    }
    if (current.status === "removed") {
      changes.push({ field: "status", oldValue: "removed", newValue: "active" });
    }
    if (starId !== current.starId) {
      changes.push({
        field: "star",
        oldValue: starsById.get(current.starId)?.name ?? null,
        newValue: planet.hostName,
      });
    }
    for (const field of TRACKED_FIELDS) {
      if (current[field] !== planet[field]) {
        changes.push({
          field,
          oldValue: show(current[field]),
          newValue: show(planet[field]),
        });
      }
    }

    // The derived classes can change without new measurements, namely when
    // the rules in classify.ts were adjusted.
    const derivedChanged =
      current.planetClass !== planet.planetClass ||
      current.climateClass !== planet.climateClass ||
      current.dataHash !== planet.dataHash;

    if (changes.length > 0 || derivedChanged) {
      plan.planetUpdates.push({
        id: current.id,
        planet,
        slug: rename ? uniqueSlug(planet.name, planetSlugs) : current.slug,
        rename,
        changes,
      });
      plan.counts.updated++;
    } else {
      plan.counts.unchanged++;
    }
  }

  plan.planetRemovals = vanishedPlanets.filter((p) => !claimedPlanets.has(p.id)).map((p) => p.id);
  plan.counts.removed = plan.planetRemovals.length;

  return plan;
}

/**
 * Guard against a broken or incomplete response from NASA. Returns a reason
 * when the run should rather stop, otherwise `null`.
 */
export function implausible(
  plan: SyncPlan,
  activeBefore: number,
  incomingCount: number,
): string | null {
  if (incomingCount < 1000) {
    return `NASA delivered only ${incomingCount} planets. Several thousand are expected.`;
  }
  if (incomingCount < activeBefore * 0.9) {
    return `NASA delivered ${incomingCount} planets, but ${activeBefore} are stored.`;
  }
  const limit = Math.max(25, Math.round(activeBefore * 0.05));
  if (plan.counts.removed > limit) {
    return `${plan.counts.removed} planets would be marked as removed, the limit is ${limit}.`;
  }
  return null;
}
