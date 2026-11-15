import { describe, expect, it } from "vitest";
import { planetAppearance, type AppearanceInput } from "@/app/planets/appearance";

function input(overrides: Partial<AppearanceInput> = {}): AppearanceInput {
  return {
    slug: "test-b",
    source: "nasa",
    planetClass: "rocky",
    climateClass: "temperate",
    starTeffK: 5800,
    ...overrides,
  };
}

describe("planetAppearance", () => {
  it("gives the same planet the same look every time", () => {
    expect(planetAppearance(input())).toEqual(planetAppearance(input()));
  });

  it("gives planets of the same kind different patterns", () => {
    const a = planetAppearance(input({ slug: "kepler-22-b" }));
    const b = planetAppearance(input({ slug: "kepler-452-b" }));
    expect(a.base).toBe(b.base);
    expect(a.seed).not.toBe(b.seed);
  });

  it("draws bands on gaseous planets and patches on solid ones", () => {
    expect(planetAppearance(input({ planetClass: "gas_giant" })).banded).toBe(true);
    expect(planetAppearance(input({ planetClass: "neptune_like" })).banded).toBe(true);
    expect(planetAppearance(input({ planetClass: "super_earth" })).banded).toBe(false);
    expect(planetAppearance(input({ planetClass: "rocky" })).banded).toBe(false);
  });

  it("changes the colours with the climate", () => {
    const frozen = planetAppearance(input({ climateClass: "frozen" }));
    const scorching = planetAppearance(input({ climateClass: "scorching" }));
    expect(frozen.base).not.toBe(scorching.base);
  });

  it("still returns a look when class and climate are unknown", () => {
    const look = planetAppearance(input({ planetClass: null, climateClass: null }));
    expect(look.base).toMatch(/^#[0-9a-f]{6}$/);
    expect(look.layers.length).toBeGreaterThan(0);
    expect(look.atmosphere).toBeNull();
  });

  it("tints the planet by the colour of its star", () => {
    expect(planetAppearance(input({ starTeffK: 3000 })).starTint).toBe("#ff6a3a");
    expect(planetAppearance(input({ starTeffK: 4500 })).starTint).toBe("#ffa25e");
    expect(planetAppearance(input({ starTeffK: 5800 })).starTint).toBeNull();
    expect(planetAppearance(input({ starTeffK: 9000 })).starTint).toBe("#9cc0ff");
    expect(planetAppearance(input({ starTeffK: null })).starTint).toBeNull();
  });

  it("uses the real colours for the solar system", () => {
    const saturn = planetAppearance(
      input({ slug: "saturn", source: "sol", planetClass: "gas_giant", climateClass: "frozen" }),
    );
    expect(saturn.rings).toBe(true);
    expect(saturn.banded).toBe(true);

    const earth = planetAppearance(input({ slug: "earth", source: "sol" }));
    expect(earth.base).toBe("#1f4f8f");
    expect(earth.rings).toBe(false);
  });

  it("applies the general rules to an exoplanet that happens to share a slug", () => {
    const look = planetAppearance(
      input({ slug: "saturn", source: "nasa", planetClass: "gas_giant" }),
    );
    expect(look.rings).toBe(false);
  });
});
