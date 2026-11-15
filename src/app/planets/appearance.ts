import type { ClimateClass, PlanetClass } from "./classify";
import type { GlobeSpec } from "./globe/spec";

/**
 * What a planet looks like. The still image, the moving image and the 3D model
 * all read this description, so they show the same planet.
 */
export interface Appearance {
  /** Base colour of the sphere. */
  base: string;
  /** Patches or bands on top of the base colour, from bottom to top. Used by the still image. */
  layers: Layer[];
  /** Bands as on Jupiter instead of patches as with continents. */
  banded: boolean;
  /** Colour of the atmosphere rim, or nothing for planets without a visible envelope. */
  atmosphere: string | null;
  /** Colour cast from the light of the star, or nothing for sun-like light. */
  starTint: string | null;
  rings: boolean;
  /** Seed of the random pattern. Same planet, same image. */
  seed: number;
  /** The same look in the detail the moving image and the 3D model need. */
  globe: GlobeSpec;
}

export interface Layer {
  color: string;
  /** Share of the surface the layer roughly covers, 0 to 1. */
  coverage: number;
  opacity: number;
}

export interface AppearanceInput {
  slug: string;
  source: "nasa" | "sol";
  planetClass: PlanetClass | null;
  climateClass: ClimateClass | null;
  starTeffK: number | null;
}

/** The parts of a globe that depend on the kind of planet. Everything left out gets a default. */
type Traits = Partial<
  Pick<
    GlobeSpec,
    "palette" | "ocean" | "ice" | "clouds" | "glow" | "craters" | "relief" | "bands"
  >
> & { density?: number };

type Look = Pick<Appearance, "base" | "layers" | "atmosphere"> & {
  rings?: boolean;
  traits?: Traits;
};

const layer = (color: string, coverage: number, opacity = 1): Layer => ({
  color,
  coverage,
  opacity,
});

/** Rocky planets and super-Earths: solid surface, look depends on temperature. */
const SOLID: Record<ClimateClass | "unknown", Look> = {
  // A shell of ice with darker, older ice in between.
  frozen: {
    base: "#c9d6e2",
    layers: [layer("#8ea4ba", 0.45), layer("#f4f8fb", 0.3)],
    atmosphere: "#cfe4ff",
    traits: { ice: 0.32, clouds: { color: "#ffffff", cover: 0.12 }, density: 0.35, craters: 0.25 },
  },
  // Dry and dusty with small polar caps, like Mars.
  cold: {
    base: "#a67c5f",
    layers: [layer("#6f5142", 0.45), layer("#e6ddd2", 0.18, 0.9)],
    atmosphere: "#e0c7b0",
    traits: {
      ice: 0.2,
      clouds: { color: "#f3e9dc", cover: 0.1 },
      density: 0.35,
      craters: 0.35,
    },
  },
  // Liquid water is possible here, so the image shows oceans, land and clouds.
  temperate: {
    base: "#255a94",
    layers: [layer("#4a7a4f", 0.38), layer("#b9a37a", 0.16), layer("#ffffff", 0.3, 0.8)],
    atmosphere: "#8ec5ff",
    traits: {
      palette: ["#3f6f45", "#a8946c", "#8a8279"],
      ocean: { color: "#1c4f8a", level: 0.03 },
      ice: 0.14,
      clouds: { color: "#ffffff", cover: 0.5 },
      density: 1,
    },
  },
  // Too hot for water: deserts and dust.
  hot: {
    base: "#c2905a",
    layers: [layer("#8a552c", 0.45), layer("#e6c690", 0.25)],
    atmosphere: "#f1d2a0",
    traits: { clouds: { color: "#f0dcb4", cover: 0.18 }, density: 0.6 },
  },
  // Hot enough to melt rock: a dark crust with glowing lava.
  scorching: {
    base: "#2b1b18",
    layers: [layer("#57241a", 0.5), layer("#ff6a2a", 0.16), layer("#ffd27a", 0.05)],
    atmosphere: "#ff7b3d",
    traits: {
      palette: ["#140d0c", "#2b1b18", "#4a2a22"],
      glow: { color: "#ff5a1f", strength: 1 },
      density: 0.4,
      relief: 1.2,
    },
  },
  // Nothing known about the temperature: bare, cratered rock.
  unknown: {
    base: "#85878f",
    layers: [layer("#5d5f69", 0.45), layer("#b3b5bd", 0.2)],
    atmosphere: null,
    traits: { craters: 1, relief: 1.2 },
  },
};

const SOFT_BANDS = { contrast: 0.55, turbulence: 0.6, storms: 0.25 };
const STRONG_BANDS = { contrast: 1, turbulence: 1, storms: 0.6 };

/** Neptune-like planets: thick envelope, soft bands. */
const NEPTUNE: Record<ClimateClass | "unknown", Look> = {
  frozen: {
    base: "#3b6fd6",
    layers: [layer("#2a4fa8", 0.45), layer("#8fc4f0", 0.2, 0.8)],
    atmosphere: "#8fc4ff",
  },
  cold: {
    base: "#62b7cf",
    layers: [layer("#3f8fae", 0.45), layer("#c5eef5", 0.2, 0.8)],
    atmosphere: "#b5f0ff",
  },
  temperate: {
    base: "#4d8fb8",
    layers: [layer("#356b93", 0.45), layer("#e6f0f5", 0.25, 0.8)],
    atmosphere: "#a8dcff",
  },
  hot: {
    base: "#8f86c4",
    layers: [layer("#655c9c", 0.45), layer("#cfc6ea", 0.22, 0.8)],
    atmosphere: "#cfc0ff",
  },
  scorching: {
    base: "#3a2f6b",
    layers: [layer("#22193f", 0.5), layer("#c75a8a", 0.14, 0.8)],
    atmosphere: "#d98cff",
    traits: { glow: { color: "#c0407a", strength: 0.35 } },
  },
  unknown: {
    base: "#5f86ad",
    layers: [layer("#456886", 0.45), layer("#b9d0e2", 0.2, 0.8)],
    atmosphere: "#a8ccee",
  },
};

/** Gas giants: strong bands, dark and glowing when very hot. */
const GIANT: Record<ClimateClass | "unknown", Look> = {
  frozen: {
    base: "#d6b98c",
    layers: [layer("#a9764e", 0.45), layer("#f0e4cc", 0.3)],
    atmosphere: "#f2ddb8",
  },
  cold: {
    base: "#d9c39a",
    layers: [layer("#b08a5c", 0.42), layer("#f3ead6", 0.3)],
    atmosphere: "#f5e6c4",
  },
  temperate: {
    base: "#d9d6cc",
    layers: [layer("#a9b4c6", 0.42), layer("#ffffff", 0.3)],
    atmosphere: "#dfe9ff",
  },
  hot: {
    base: "#7d8aa3",
    layers: [layer("#4f5b78", 0.45), layer("#b4bfd4", 0.25)],
    atmosphere: "#b8c8ee",
  },
  scorching: {
    base: "#3a2030",
    layers: [layer("#1f1220", 0.45), layer("#b3472e", 0.3), layer("#ff9a4a", 0.1)],
    atmosphere: "#ff8a4a",
    traits: {
      palette: ["#1f1220", "#3a2030", "#8c3a2a"],
      glow: { color: "#ff6a2a", strength: 0.6 },
    },
  },
  unknown: {
    base: "#b3a58c",
    layers: [layer("#8a7a62", 0.45), layer("#ddd3c0", 0.25)],
    atmosphere: "#e6dcc8",
  },
};

/** What only the planets of the solar system have: a real map and the real tilt of the axis. */
interface SolarSystemLook extends Look {
  banded: boolean;
  /** Tilt of the axis in degrees. */
  tiltDeg: number;
  /** Negative for the planets that turn backwards. */
  spin?: number;
  /** A second map with the lights of the cities at night. */
  night?: boolean;
  /** A third map with the clouds. */
  cloudMap?: boolean;
}

/**
 * Everybody knows the planets of the solar system, so they get their real
 * colours and real maps of their surface instead of the general rules. Keyed
 * by slug.
 */
const SOLAR_SYSTEM: Record<string, SolarSystemLook> = {
  mercury: {
    base: "#8f8a85",
    layers: [layer("#6a6560", 0.45), layer("#b5afa8", 0.2)],
    atmosphere: null,
    banded: false,
    tiltDeg: 0,
    traits: { relief: 1.5 },
  },
  venus: {
    base: "#d9b77a",
    layers: [layer("#c49a58", 0.45), layer("#f0deb0", 0.3)],
    atmosphere: "#f5e2b0",
    banded: true,
    tiltDeg: 3,
    spin: -0.6,
    traits: { density: 1, relief: 0 },
  },
  earth: {
    base: "#1f4f8f",
    layers: [layer("#3f7a48", 0.36), layer("#b39b6e", 0.14), layer("#ffffff", 0.32, 0.85)],
    atmosphere: "#7fbaff",
    banded: false,
    tiltDeg: 23.4,
    night: true,
    cloudMap: true,
    traits: { ocean: { color: "#1f4f8f", level: 0 }, density: 1, relief: 0.8 },
  },
  mars: {
    base: "#b5532f",
    layers: [layer("#7c3320", 0.42), layer("#dc9a70", 0.2)],
    atmosphere: "#e8b090",
    banded: false,
    tiltDeg: 25.2,
    traits: { density: 0.3, relief: 1.2 },
  },
  jupiter: {
    base: "#d2b48c",
    layers: [layer("#a5673f", 0.42), layer("#efe3cd", 0.32)],
    atmosphere: "#f0dcbc",
    banded: true,
    tiltDeg: 3.1,
    spin: 1.4,
    traits: { density: 0.5, relief: 0 },
  },
  saturn: {
    base: "#dcc592",
    layers: [layer("#bfa26a", 0.4), layer("#f1e6c6", 0.3)],
    atmosphere: "#f3e6c0",
    banded: true,
    rings: true,
    tiltDeg: 26.7,
    spin: 1.4,
    traits: { density: 0.5, relief: 0 },
  },
  uranus: {
    base: "#a6dfe3",
    layers: [layer("#8fd0d6", 0.4, 0.7), layer("#c9f0f2", 0.2, 0.6)],
    atmosphere: "#c9f6ff",
    banded: true,
    // Uranus lies on its side.
    tiltDeg: 82,
    spin: -1,
    traits: { density: 0.6, relief: 0 },
  },
  neptune: {
    base: "#3558c9",
    layers: [layer("#2742a0", 0.42), layer("#7fa6f0", 0.16, 0.8)],
    atmosphere: "#86aaff",
    banded: true,
    tiltDeg: 28.3,
    traits: { density: 0.6, relief: 0 },
  },
};

/** The main rings of Saturn reach from 1.24 to 2.27 times the radius of the planet. */
const SATURN_RINGS = { inner: 1.24, outer: 2.27, map: "saturn-ring" };

/** Cool stars shine reddish, hot stars bluish. Sun-like light stays neutral. */
function starTint(teffK: number | null): string | null {
  if (teffK === null) return null;
  if (teffK < 3700) return "#ff6a3a";
  if (teffK < 4800) return "#ffa25e";
  if (teffK > 7500) return "#9cc0ff";
  return null;
}

/** The colour of the starlight for the 3D model: the tint, but paler, so colours stay readable. */
function starLight(teffK: number | null): string {
  if (teffK === null) return "#ffffff";
  if (teffK < 3700) return "#ffe2d2";
  if (teffK < 4800) return "#ffeee0";
  if (teffK > 7500) return "#edf2ff";
  return "#ffffff";
}

/** A number from a text, always the same for the same text (FNV-1a). */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function globe(
  look: Look,
  rest: Pick<GlobeSpec, "kind" | "seed" | "light" | "rings" | "tiltDeg" | "spin" | "maps">,
): GlobeSpec {
  const traits = look.traits ?? {};
  return {
    palette: traits.palette ?? [look.layers[0].color, look.base, look.layers[1].color],
    ocean: traits.ocean ?? null,
    ice: traits.ice ?? 0,
    clouds: traits.clouds ?? null,
    glow: traits.glow ?? null,
    craters: traits.craters ?? 0,
    relief: traits.relief ?? 1,
    bands: traits.bands ?? STRONG_BANDS,
    atmosphere: look.atmosphere
      ? { color: look.atmosphere, density: traits.density ?? 0.7 }
      : null,
    ...rest,
  };
}

/** Derives the look of a planet from its class, its climate and the temperature of its star. */
export function planetAppearance(input: AppearanceInput): Appearance {
  const seed = (hash(input.slug) % 9973) + 1;

  const sol = input.source === "sol" ? SOLAR_SYSTEM[input.slug] : undefined;
  if (sol) {
    return {
      base: sol.base,
      layers: sol.layers,
      atmosphere: sol.atmosphere,
      banded: sol.banded,
      rings: sol.rings ?? false,
      starTint: null,
      seed,
      globe: globe(sol, {
        kind: "map",
        seed,
        light: "#ffffff",
        rings: sol.rings ? SATURN_RINGS : null,
        tiltDeg: sol.tiltDeg,
        spin: sol.spin ?? 1,
        maps: {
          day: input.slug,
          night: sol.night ? `${input.slug}-night` : null,
          clouds: sol.cloudMap ? `${input.slug}-clouds` : null,
        },
      }),
    };
  }

  const climate = input.climateClass ?? "unknown";
  const gaseous =
    input.planetClass === "gas_giant" || input.planetClass === "neptune_like";
  const look: Look =
    input.planetClass === "gas_giant"
      ? GIANT[climate]
      : input.planetClass === "neptune_like"
        ? { ...NEPTUNE[climate], traits: { bands: SOFT_BANDS, ...NEPTUNE[climate].traits } }
        : SOLID[climate];

  return {
    base: look.base,
    layers: look.layers,
    atmosphere: look.atmosphere,
    banded: gaseous,
    rings: false,
    starTint: starTint(input.starTeffK),
    seed,
    globe: globe(look, {
      kind: gaseous ? "gas" : "solid",
      seed,
      light: starLight(input.starTeffK),
      rings: null,
      // The real tilt is unknown, so every planet gets its own between 0 and 30 degrees.
      tiltDeg: (hash(`${input.slug}/tilt`) % 300) / 10,
      // Gas giants turn fast.
      spin: gaseous ? 1.3 : 1,
      maps: null,
    }),
  };
}
