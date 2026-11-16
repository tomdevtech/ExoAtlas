import { describe, expect, it } from "vitest";
import { planetAppearance, type AppearanceInput } from "@/app/planets/appearance";
import PRESETS from "@/app/planets/globe/presets.json";

function input(overrides: Partial<AppearanceInput> = {}): AppearanceInput {
  return {
    slug: "test-b",
    source: "nasa",
    planetClass: "rocky",
    climateClass: "temperate",
    starTeffK: 5800,
    radiusEarth: null,
    eqTempK: null,
    densityEarth: null,
    orbitalPeriodDays: null,
    ...overrides,
  };
}

describe("planetAppearance", () => {
  it("gives the same planet the same look every time", () => {
    expect(planetAppearance(input())).toEqual(planetAppearance(input()));
  });

  it("gives planets of the same kind different patterns and colours", () => {
    const a = planetAppearance(input({ slug: "kepler-22-b" }));
    const b = planetAppearance(input({ slug: "kepler-452-b" }));
    expect(a.globe.kind).toBe(b.globe.kind);
    expect(a.seed).not.toBe(b.seed);
    expect(a.base).not.toBe(b.base);
    expect(a.globe.ocean?.color).not.toBe(b.globe.ocean?.color);
  });

  it("draws every exoplanet from a preset, turned and mirrored its own way", () => {
    const names = Array.from({ length: 40 }, (_, index) => `planet-${index}-b`);
    const rocky = names.map((slug) => planetAppearance(input({ slug })).globe);
    const giants = names.map(
      (slug) => planetAppearance(input({ slug, planetClass: "gas_giant" })).globe,
    );
    for (const globe of rocky) {
      expect(globe.kind).toBe("terrain");
      expect(["continents", "archipelago", "supercontinent", "highlands"]).toContain(globe.maps.day);
      // A sea that covers between a little under half and most of the surface.
      expect(globe.ocean?.level).toBeGreaterThan(0);
      expect(globe.ocean?.level).toBeLessThan(1);
    }
    for (const globe of giants) {
      expect(globe.kind).toBe("bands");
      expect(globe.maps.day).toMatch(/^bands-/);
      expect(globe.flow).toBe(1);
    }
    // A turn only turns or mirrors: its three columns have the length 1 and stand at right angles.
    const columns = (turn: number[]) => [turn.slice(0, 3), turn.slice(3, 6), turn.slice(6, 9)];
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    for (const globe of [...rocky, ...giants]) {
      const [x, y, z] = columns(globe.turn);
      for (const column of [x, y, z]) expect(dot(column, column)).toBeCloseTo(1, 3);
      expect(dot(x, y)).toBeCloseTo(0, 3);
      expect(dot(x, z)).toBeCloseTo(0, 3);
      expect(dot(y, z)).toBeCloseTo(0, 3);
    }
    // The belts of a gas planet have to follow its latitudes: it only turns about its axis.
    for (const globe of giants) expect(Math.abs(columns(globe.turn)[1][1])).toBe(1);
    // A rocky planet may lie any way, and nearly all of them lie askew.
    expect(rocky.filter((globe) => Math.abs(columns(globe.turn)[1][1]) < 0.95).length).toBeGreaterThan(30);
    // Planets from the same preset still differ.
    expect(new Set(rocky.map((globe) => globe.maps.day)).size).toBeGreaterThan(1);
    expect(new Set(rocky.map((globe) => globe.turn.join())).size).toBe(rocky.length);
    expect(new Set(rocky.map((globe) => globe.ocean?.level)).size).toBeGreaterThan(30);
  });

  it("mixes two base maps on a rocky planet, each turned its own way", () => {
    const names = Array.from({ length: 40 }, (_, index) => `mixed-${index}-b`);
    for (const climateClass of ["frozen", "cold", "temperate", "hot", "scorching", null] as const) {
      for (const slug of names) {
        const globe = planetAppearance(input({ slug, climateClass })).globe;
        expect(globe.second).not.toBeNull();
        expect(globe.second?.map).not.toBe(globe.maps.day);
        expect(Object.keys(PRESETS.terrain)).toContain(globe.second?.map);
        expect(globe.second?.turn).not.toEqual(globe.turn);
      }
    }
    // Gas planets and the planets of the solar system have one map.
    expect(planetAppearance(input({ planetClass: "gas_giant" })).globe.second).toBeNull();
    expect(planetAppearance(input({ slug: "mars", source: "sol" })).globe.second).toBeNull();
  });

  it("colours a gas planet by its temperature", () => {
    const channels = (hex: string) =>
      [16, 8, 0].map((shift) => (Number.parseInt(hex.slice(1), 16) >> shift) & 0xff);
    const base = (planetClass: "gas_giant" | "neptune_like", eqTempK: number | null) =>
      channels(planetAppearance(input({ planetClass, eqTempK })).base);
    // Cream and brown where ammonia freezes, blue where the air is clear, dark where it is hot.
    const [coldRed, , coldBlue] = base("gas_giant", 110);
    expect(coldRed).toBeGreaterThan(coldBlue);
    const [clearRed, , clearBlue] = base("gas_giant", 600);
    expect(clearBlue).toBeGreaterThan(clearRed);
    const sum = (rgb: number[]) => rgb[0] + rgb[1] + rgb[2];
    expect(sum(base("gas_giant", 1500))).toBeLessThan(sum(base("gas_giant", 220)) * 0.5);
    // Between two of these the colour changes step by step, not all at once.
    expect(base("gas_giant", 400)).not.toEqual(base("gas_giant", 330));
    expect(base("gas_giant", 400)).not.toEqual(base("gas_giant", 600));
    // Cold planets like Neptune are blue, and a planet of unknown temperature gets a colour as well.
    const [neptuneRed, , neptuneBlue] = base("neptune_like", 60);
    expect(neptuneBlue).toBeGreaterThan(neptuneRed);
    expect(sum(base("neptune_like", null))).toBeGreaterThan(0);
    // From about 900 kelvin a giant glows by itself, the more the hotter it is.
    const glow = (eqTempK: number) =>
      planetAppearance(input({ planetClass: "gas_giant", eqTempK })).globe.glow;
    expect(glow(600)).toBeNull();
    expect(glow(1200)?.strength).toBeGreaterThan(0);
    expect(glow(2300)?.strength).toBeGreaterThan(glow(1200)?.strength ?? 0);
    // No two planets of the same temperature have quite the same colours.
    const bases = Array.from({ length: 30 }, (_, index) =>
      planetAppearance(input({ slug: `twin-${index}-b`, planetClass: "gas_giant", eqTempK: 130 })).base,
    );
    expect(new Set(bases).size).toBeGreaterThan(25);
  });

  it("holds a planet close to its star with one side towards it", () => {
    for (const planetClass of ["rocky", "gas_giant"] as const) {
      const held = planetAppearance(input({ planetClass, orbitalPeriodDays: 3 })).globe;
      expect(held.locked).toBe(1);
      expect(held.tiltDeg).toBe(0);
      expect(held.flattening).toBe(0);
      expect(held.rings).toBeNull();
      expect(held.moon).toBeNull();
      const free = planetAppearance(input({ planetClass, orbitalPeriodDays: 300 })).globe;
      expect(free.locked).toBe(0);
      expect(free.spin).toBeGreaterThan(0);
      // The ground of a held planet stands still. The clouds of a held gas
      // planet go on circling it, slower than those of a free one.
      if (planetClass === "rocky") expect(held.spin).toBe(0);
      else {
        expect(held.spin).toBeGreaterThan(0);
        expect(held.spin).toBeLessThan(free.spin);
      }
      // Without a known orbit a planet has days and nights.
      expect(planetAppearance(input({ planetClass })).globe.locked).toBe(0);
    }
    // In between the hold loosens step by step.
    const loose = planetAppearance(input({ orbitalPeriodDays: 21 })).globe.locked;
    expect(loose).toBeGreaterThan(0);
    expect(loose).toBeLessThan(1);
    // On a mild world held by its star the ice covers the night side instead of the poles.
    const held = planetAppearance(input({ orbitalPeriodDays: 3 })).globe;
    const free = planetAppearance(input({ orbitalPeriodDays: 300 })).globe;
    expect(held.ice).toBeGreaterThan(0.4);
    expect(held.ice).toBeGreaterThan(free.ice);
    expect(held.zones).toBe(1);
  });

  it("reads from the density what a rocky planet is made of", () => {
    const made = (densityEarth: number | null, extra: Partial<AppearanceInput> = {}) =>
      planetAppearance(input({ radiusEarth: 1.5, densityEarth, ...extra })).globe;
    const level = (share: number, globe: ReturnType<typeof made>) => {
      const levels = (name: string) => PRESETS.terrain[name as keyof typeof PRESETS.terrain].levels;
      const at = (name: string) => levels(name)[Math.round(share * 20)];
      return (at(globe.maps.day) + at(globe.second?.map ?? globe.maps.day)) / 2;
    };
    // Rock like Earth, squeezed a little by its own weight, or nothing measured: an ordinary world.
    const rock = made(1.4);
    expect(rock).toEqual(made(null));
    // Far too light for rock: a world of water, nearly all sea.
    const water = made(0.5);
    expect(water.ocean?.level).toBeGreaterThan(level(0.9, water));
    expect(rock.ocean?.level).toBeLessThanOrEqual(level(0.9, rock) + 0.001);
    // On a cold world the water is a shell of ice, on a hot one a deck of steam.
    expect(made(0.5, { climateClass: "cold" }).maps.day).toBe("icecrust");
    expect(made(0.5, { climateClass: "hot" }).clouds?.cover).toBeGreaterThan(0.8);
    // Far too heavy: a world of iron, darker and greyer.
    const brightness = (hex: string) =>
      [16, 8, 0].reduce((sum, shift) => sum + ((Number.parseInt(hex.slice(1), 16) >> shift) & 0xff), 0);
    const iron = made(2.6, { climateClass: "hot" });
    const dust = made(1.4, { climateClass: "hot" });
    expect(brightness(iron.palette[1])).toBeLessThan(brightness(dust.palette[1]));
  });

  it("gives some planets rings, moons, polar lights and a flattened shape", () => {
    const names = Array.from({ length: 300 }, (_, index) => `world-${index}-b`);
    const giants = names.map(
      (slug) => planetAppearance(input({ slug, planetClass: "gas_giant", eqTempK: 120 })).globe,
    );
    const ringed = giants.filter((globe) => globe.rings);
    expect(ringed.length).toBeGreaterThan(30);
    expect(ringed.length).toBeLessThan(110);
    for (const globe of ringed) {
      expect(globe.rings!.outer).toBeGreaterThan(globe.rings!.inner);
      expect(globe.rings!.inner).toBeGreaterThan(1.2);
      // Rings seen edge-on would be a line, and a moon would have to pass through them.
      expect(globe.tiltDeg).toBeGreaterThanOrEqual(12);
      expect(globe.moon).toBeNull();
    }
    for (const globe of giants) {
      expect(globe.flattening).toBeGreaterThanOrEqual(0.03);
      expect(globe.flattening).toBeLessThanOrEqual(0.1);
      // A moon circles outside the planet and inside the picture.
      if (globe.moon) expect(globe.moon.distance - globe.moon.size).toBeGreaterThan(1.05);
    }
    expect(giants.filter((globe) => globe.moon).length).toBeGreaterThan(40);
    expect(giants.filter((globe) => globe.aurora).length).toBeGreaterThan(70);
    const stormy = giants.filter((globe) => globe.lightning > 0).length;
    expect(stormy).toBeGreaterThan(70);
    expect(stormy).toBeLessThan(140);

    // Rocky planets stay round and bare of rings; some have a moon.
    const rocky = names.map((slug) => planetAppearance(input({ slug })).globe);
    for (const globe of rocky) {
      expect(globe.rings).toBeNull();
      expect(globe.flattening).toBe(0);
      expect(globe.lightning).toBe(0);
    }
    expect(rocky.filter((globe) => globe.moon).length).toBeGreaterThan(20);
    // The storms of a red dwarf light up the sky of its planets more often.
    const lights = (starTeffK: number) =>
      names.filter((slug) => planetAppearance(input({ slug, starTeffK })).globe.aurora).length;
    expect(lights(3200)).toBeGreaterThan(lights(5800) * 1.5);
    // Without air there is nothing to light up.
    for (const slug of names.slice(0, 40)) {
      expect(planetAppearance(input({ slug, climateClass: null })).globe.aurora).toBeNull();
    }
  });

  it("lets the winds a band preset was simulated with blow on", () => {
    const names = Array.from({ length: 40 }, (_, index) => `giant-${index}-b`);
    const globes = names.flatMap((slug) =>
      (["gas_giant", "neptune_like"] as const).map(
        (planetClass) => planetAppearance(input({ slug, planetClass })).globe,
      ),
    );
    for (const globe of globes) {
      const winds = PRESETS.bands[globe.maps.day as keyof typeof PRESETS.bands];
      expect(globe.jets).toEqual([winds.strength, winds.count, winds.equator, winds.narrowness]);
      // Between two thirds and all of the latitudes of the preset, with its jets where it has them.
      expect(globe.belts[0]).toBeGreaterThanOrEqual(0.64);
      expect(globe.belts[0]).toBeLessThanOrEqual(1);
      expect(globe.belts[1]).toBe(winds.phase);
      expect(globe.bands.storms).toBeGreaterThanOrEqual(0.4);
      expect(globe.bands.storms).toBeLessThanOrEqual(1);
    }
    // Every band preset is in use and brings winds of its own.
    expect(new Set(globes.map((globe) => globe.maps.day))).toEqual(new Set(Object.keys(PRESETS.bands)));
    expect(new Set(globes.map((globe) => globe.jets.join())).size).toBe(Object.keys(PRESETS.bands).length);
    // The fastest latitude of each preset has about the speed 1, forwards or backwards.
    for (const winds of Object.values(PRESETS.bands)) {
      expect(winds.strength + Math.abs(winds.equator)).toBeCloseTo(1, 2);
    }
    // Rocky planets have no bands to drift.
    const rocky = planetAppearance(input()).globe;
    expect(rocky.flow).toBe(0);
    expect(rocky.bands.storms).toBe(0);
  });

  it("colours the plants by the light of the star", () => {
    const plants = (starTeffK: number | null) =>
      planetAppearance(input({ starTeffK })).globe.palette[0];
    // Green under a Sun-like star, or when the star is unknown.
    expect(plants(5800)).toBe("#3f6f45");
    expect(plants(null)).toBe("#3f6f45");
    // Nearly black under a red dwarf, blue under a hot star.
    const brightness = (hex: string) =>
      [16, 8, 0].reduce((sum, shift) => sum + ((Number.parseInt(hex.slice(1), 16) >> shift) & 0xff), 0);
    expect(brightness(plants(2600))).toBeLessThan(brightness(plants(5800)) * 0.5);
    const blue = (hex: string) => Number.parseInt(hex.slice(1), 16) & 0xff;
    const green = (hex: string) => (Number.parseInt(hex.slice(1), 16) >> 8) & 0xff;
    expect(blue(plants(8000))).toBeGreaterThan(green(plants(8000)));
    // In between the colour changes step by step, not all at once.
    expect(plants(5300)).not.toBe(plants(4800));
    expect(plants(5300)).not.toBe(plants(5800));
    // The still image shows the same plants.
    expect(planetAppearance(input({ starTeffK: 3000 })).layers[0].color).toBe(plants(3000));
    // Only worlds with life: a desert keeps its dust whatever the star.
    const desert = (starTeffK: number) =>
      planetAppearance(input({ climateClass: "hot", starTeffK })).globe.palette;
    expect(desert(3000)).toEqual(desert(8000));
  });

  it("lets a tilted axis blur the climate zones and shrink the ice caps", () => {
    const names = Array.from({ length: 60 }, (_, index) => `tilted-${index}-b`);
    const globes = names.map((slug) => planetAppearance(input({ slug })).globe);
    const upright = globes.reduce((a, b) => (a.tiltDeg < b.tiltDeg ? a : b));
    const tilted = globes.reduce((a, b) => (a.tiltDeg > b.tiltDeg ? a : b));
    expect(tilted.tiltDeg - upright.tiltDeg).toBeGreaterThan(20);
    expect(tilted.zones).toBeLessThan(upright.zones);
    expect(tilted.ice).toBeLessThan(upright.ice);
    for (const globe of globes) {
      expect(globe.zones).toBeGreaterThanOrEqual(0.4);
      expect(globe.zones).toBeLessThanOrEqual(1);
    }
    // Gas giants and the planets of the solar system keep their bands and maps.
    expect(planetAppearance(input({ planetClass: "gas_giant" })).globe.zones).toBe(1);
    expect(planetAppearance(input({ slug: "earth", source: "sol" })).globe.zones).toBe(1);
  });

  it("lets the temperature shape a world within its climate class", () => {
    const at = (climateClass: AppearanceInput["climateClass"], eqTempK: number | null) =>
      planetAppearance(input({ climateClass, eqTempK })).globe;

    // A mild world near freezing: more ice, fewer clouds, lower seas than one near boiling.
    const chilly = at("temperate", 255);
    const balmy = at("temperate", 345);
    expect(chilly.ice).toBeGreaterThan(balmy.ice * 2);
    expect(chilly.clouds?.cover).toBeLessThan(balmy.clouds?.cover ?? 0);
    expect(chilly.ocean?.level).toBeLessThan(balmy.ocean?.level ?? 0);
    // Without a temperature the world sits in the middle of its class.
    const unknown = at("temperate", null);
    expect(unknown.ice).toBeGreaterThan(balmy.ice);
    expect(unknown.ice).toBeLessThan(chilly.ice);
    expect(unknown).toEqual(at("temperate", 300));
    // Everything that is drawn from the name stays as it was.
    expect(chilly.maps).toEqual(balmy.maps);
    expect(chilly.turn).toEqual(balmy.turn);
    expect(chilly.tiltDeg).toBe(balmy.tiltDeg);

    // The hotter a lava world, the more of it is lava and the brighter it glows.
    const warm = at("scorching", 1100);
    const blazing = at("scorching", 2400);
    expect(blazing.terrain[0]).toBeGreaterThan(warm.terrain[0]);
    expect(blazing.glow?.strength).toBeGreaterThan(warm.glow?.strength ?? 0);

    // A hot desert only begins to glow near the melting point of rock.
    expect(at("hot", 450).glow).toBeNull();
    expect(at("hot", 950).glow?.strength).toBeGreaterThan(0);

    // Temperatures outside the class do not overshoot.
    expect(at("temperate", 900)).toEqual(at("temperate", 350));
    expect(at("cold", 10)).toEqual(at("cold", 150));

    // Glowing gas giants follow the temperature too.
    const giant = (eqTempK: number) =>
      planetAppearance(input({ planetClass: "gas_giant", climateClass: "scorching", eqTempK })).globe;
    expect(giant(2400).glow?.strength).toBeGreaterThan(giant(1100).glow?.strength ?? 0);
  });

  it("gives heavier planets lower mountains", () => {
    const small = planetAppearance(input({ radiusEarth: 0.8 })).globe;
    const large = planetAppearance(input({ radiusEarth: 1.9 })).globe;
    expect(large.terrain[2]).toBeLessThan(small.terrain[2]);
    // The size changes nothing else about the planet.
    expect(large.maps).toEqual(small.maps);
    expect(large.turn).toEqual(small.turn);
  });

  it("fills the basins of the hottest planets with lava and leaves temperate ones their rivers", () => {
    const lava = planetAppearance(input({ climateClass: "scorching" })).globe;
    expect(lava.glow).not.toBeNull();
    expect(lava.terrain[0]).toBeGreaterThan(0);
    expect(lava.ocean).toBeNull();
    const mild = planetAppearance(input()).globe;
    expect(mild.terrain[0]).toBe(0);
    expect(mild.terrain[1]).toBe(1);
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
