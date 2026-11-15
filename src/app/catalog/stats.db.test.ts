import { describe, expect, it } from "vitest";
import { ACTIVE_EXOPLANETS } from "@/test/catalog";
import { getCatalogStats } from "./stats";

describe("getCatalogStats", () => {
  it("counts the catalogue", async () => {
    const stats = await getCatalogStats();
    expect(stats.exoplanets).toBe(ACTIVE_EXOPLANETS);
    expect(stats.solarSystemPlanets).toBe(8);
    // Every exoplanet host except Retracted-1, whose only planet was withdrawn.
    expect(stats.hostStars).toBe(10);
    // Nodist-1 has no known distance.
    expect(stats.hostStarsWithPosition).toBe(9);
    const classified = stats.byClass.reduce((sum, row) => sum + row.count, 0);
    expect(classified).toBe(ACTIVE_EXOPLANETS);
  });

  it("reports the last successful sync", async () => {
    const { lastSync } = await getCatalogStats();
    expect(lastSync).not.toBeNull();
    // The second run of the test data withdrew one planet.
    expect(lastSync?.removed).toBe(1);
    expect(lastSync?.added).toBe(0);
  });
});
