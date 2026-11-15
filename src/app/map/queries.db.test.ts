import { describe, expect, it } from "vitest";
import { getMapStars, getMapSystem } from "./queries";

describe("map queries", () => {
  it("places every star with a known position, nearest first", async () => {
    const stars = await getMapStars();
    const slugs = stars.map((star) => star.slug);
    expect(slugs[0]).toBe("sun");
    expect(slugs[1]).toBe("proxima-cen");
    expect(slugs).toContain("trappist-1");
    // Without a distance the star has no place on the map.
    expect(slugs).not.toContain("nodist-1");
    for (const star of stars) {
      expect(Number.isFinite(star.x) && Number.isFinite(star.y) && Number.isFinite(star.z)).toBe(true);
    }
  });

  it("reads a system with its active planets from the inside out", async () => {
    const system = await getMapSystem("trappist-1");
    expect(system?.star.name).toBe("TRAPPIST-1");
    expect(system?.planets.map((p) => p.slug)).toEqual(
      ["b", "c", "d", "e", "f", "g", "h"].map((letter) => `trappist-1-${letter}`),
    );
  });

  it("leaves withdrawn planets out of the system", async () => {
    const system = await getMapSystem("retracted-1");
    expect(system?.planets).toEqual([]);
  });

  it("answers null for unknown stars", async () => {
    for (const slug of ["nope", "", "../sun", "sun%00"]) {
      expect(await getMapSystem(slug), slug).toBeNull();
    }
  });
});
