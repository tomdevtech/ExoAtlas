import { withDerived } from "@/app/planets/measurements";
import { getDb } from "@/db/client";
import { planets, stars } from "@/db/schema";
import { searchKey } from "@/shared/slug";
import { SOLAR_SYSTEM_PLANETS, SUN } from "./data";

/**
 * Writes the Sun and its planets to the database and returns the number of planets.
 *
 * The NASA catalogue only contains exoplanets, so these rows carry the source `sol` and the sync leaves them
 * alone. The function may run any number of times because it overwrites existing rows.
 */
export async function seedSolarSystem(): Promise<number> {
  await getDb().transaction(async (tx) => {
    const sun = {
      ...SUN,
      searchName: searchKey(SUN.name),
      source: "sol" as const,
      planetCount: SOLAR_SYSTEM_PLANETS.length,
      updatedAt: new Date(),
    };
    const [{ id: sunId }] = await tx
      .insert(stars)
      .values(sun)
      .onConflictDoUpdate({ target: stars.slug, set: sun })
      .returning({ id: stars.id });

    for (const { name, slug, ...measured } of SOLAR_SYSTEM_PLANETS) {
      const row = {
        ...withDerived({
          ...measured,
          discoveryMethod: null,
          discoveryFacility: null,
          radiusCalculated: false,
          massCalculated: false,
          massIsMinimum: false,
          densityCalculated: false,
          // The black-body temperature is a calculated quantity, not a measurement.
          eqTempCalculated: true,
          // Sunlight falls off with the square of the distance, relative to Earth at 1 AU.
          insolation: Number((1 / measured.semiMajorAxisAu ** 2).toPrecision(3)),
          insolationCalculated: true,
        }),
        name,
        slug,
        searchName: searchKey(name),
        starId: sunId,
        source: "sol" as const,
        updatedAt: new Date(),
      };
      await tx.insert(planets).values(row).onConflictDoUpdate({ target: planets.slug, set: row });
    }
  });
  return SOLAR_SYSTEM_PLANETS.length;
}
