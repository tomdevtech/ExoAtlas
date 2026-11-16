import type { ClimateClass, PlanetClass } from "./classify";
import { mixColors, shade } from "./color";
import PRESETS from "./globe/presets.json";
import { NO_TURN, type GlobeSpec, type Turn } from "./globe/spec";

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

/**
 * What is known about a planet. Measured values shape the picture where they
 * exist: the temperature gives the colours and the climate, the density what
 * the planet is made of, the orbit whether it has days and nights. What nobody
 * has measured (the lie of the land, rings, moons, polar lights) is drawn from
 * the name of the planet, so it is always the same for the same planet.
 */
export interface AppearanceInput {
  slug: string;
  source: "nasa" | "sol";
  planetClass: PlanetClass | null;
  climateClass: ClimateClass | null;
  starTeffK: number | null;
  /** Larger planets pull harder, so their mountains are lower. */
  radiusEarth: number | null;
  /**
   * The equilibrium temperature in kelvin. The climate class says which kind
   * of world it is; the temperature says where within that kind, so a mild
   * world near freezing has more ice than one near boiling.
   */
  eqTempK: number | null;
  /**
   * The density compared with Earth, only where both mass and radius were
   * measured: it tells a world of iron from one of rock or of water.
   */
  densityEarth: number | null;
  /** A planet close to its star always turns the same side to it. */
  orbitalPeriodDays: number | null;
}

/** How much the belts of a gas planet stand out and how strongly its fine streaks show. */
type BandLook = Pick<GlobeSpec["bands"], "contrast" | "turbulence">;

/** The parts of a globe that depend on the kind of planet. Everything left out gets a default. */
type Traits = Partial<Pick<GlobeSpec, "palette" | "ocean" | "clouds" | "glow" | "relief" | "aurora">> & {
  bands?: BandLook;
  density?: number;
};

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
    traits: { clouds: { color: "#ffffff", cover: 0.12 }, density: 0.35 },
  },
  // Dry and dusty with small polar caps, like Mars.
  cold: {
    base: "#a67c5f",
    layers: [layer("#6f5142", 0.45), layer("#e6ddd2", 0.18, 0.9)],
    atmosphere: "#e0c7b0",
    traits: { clouds: { color: "#f3e9dc", cover: 0.1 }, density: 0.35 },
  },
  // Liquid water is possible here, so the image shows oceans, land and clouds.
  temperate: {
    base: "#255a94",
    layers: [layer("#4a7a4f", 0.38), layer("#b9a37a", 0.16), layer("#ffffff", 0.3, 0.8)],
    atmosphere: "#8ec5ff",
    traits: {
      palette: ["#3f6f45", "#a8946c", "#8a8279"],
      ocean: { color: "#1c4f8a", level: 0.03 },
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
    traits: { relief: 1.2 },
  },
};

/**
 * Winds on the maps of the solar system (GlobeSpec.jets). Jupiter: many narrow
 * jets in turn. Saturn: one broad, fast jet at the equator. Uranus and
 * Neptune: the equator runs backwards, the higher latitudes forwards.
 */
const NO_JETS: GlobeSpec["jets"] = [0, 0, 0, 0];
const GIANT_JETS: GlobeSpec["jets"] = [0.7, 16, 0.35, 6];
const SATURN_JETS: GlobeSpec["jets"] = [0.2, 9, 1, 5];
const ICE_GIANT_JETS: GlobeSpec["jets"] = [0.15, 6, -1, 2.5];

/** The values for the parts of a globe that its kind of surface does not use. */
const NO_TERRAIN: GlobeSpec["terrain"] = [0, 0, 1, 0];
const NO_BELTS: GlobeSpec["belts"] = [1, 0];

/** The simulated base maps (scripts/generate-presets.ts writes what the app needs to know of them into presets.json). */
type Preset = keyof typeof PRESETS.terrain;
type BandPreset = keyof typeof PRESETS.bands;

/**
 * The base maps a rocky planet can be drawn from, by climate. A name that
 * appears twice is chosen twice as often.
 */
const TERRAIN_PRESETS: Record<ClimateClass | "unknown", readonly Preset[]> = {
  frozen: ["icecrust", "icecrust", "cratered", "basins"],
  cold: ["desert", "continents", "supercontinent", "cratered", "basins", "highlands"],
  temperate: ["continents", "archipelago", "supercontinent", "highlands"],
  hot: ["desert", "volcanic", "supercontinent", "highlands", "basins"],
  scorching: ["volcanic", "volcanic", "cratered", "basins"],
  unknown: ["cratered", "basins"],
};

/** The same for gas giants and for planets like Neptune, and for those of each that are very hot or veiled in haze. */
const GIANT_PRESETS: readonly BandPreset[] = ["bands-stormy", "bands-stormy", "bands-fine", "bands-wild", "bands-broad"];
const HOT_GIANT_PRESETS: readonly BandPreset[] = ["bands-wild", "bands-wild", "bands-stormy", "bands-fine"];
const NEPTUNE_PRESETS: readonly BandPreset[] = ["bands-calm", "bands-calm", "bands-broad", "bands-hazy", "bands-fine"];
const HAZY_NEPTUNE_PRESETS: readonly BandPreset[] = ["bands-hazy", "bands-hazy", "bands-calm", "bands-broad"];

/** How deep the craters of each preset show. */
const TERRAIN_CRATERS: Record<Preset, number> = {
  continents: 0.4,
  archipelago: 0.4,
  supercontinent: 0.4,
  highlands: 0.4,
  desert: 0.7,
  cratered: 1,
  basins: 0.9,
  volcanic: 0.5,
  icecrust: 0.6,
};

const STRONG_BANDS: BandLook = { contrast: 1, turbulence: 1 };

/** The colours of a gas planet at one temperature: dark belts, base colour, bright zones, and the haze at its edge. */
interface GasColors {
  low: string;
  mid: string;
  high: string;
  atmosphere: string;
}

/**
 * What the clouds of a gas giant are made of depends on how hot it is, and
 * with it the colour (after Sudarsky's classes of giant planets). Cold giants
 * carry clouds of ammonia in creams and browns like Jupiter and Saturn. Warmer
 * ones have white clouds of water. Still warmer the clouds are gone and the
 * clear air scatters blue. Hot giants are dark, as sodium and potassium
 * swallow the light, and the hottest glow under clouds of rock dust. Between
 * the temperatures listed here the colours run into each other.
 */
const GIANT_COLORS: [tempK: number, colors: GasColors][] = [
  [60, { low: "#9a7a52", mid: "#cdb48a", high: "#efe3c8", atmosphere: "#f0dfb8" }],
  [130, { low: "#a5673f", mid: "#d2b48c", high: "#efe3cd", atmosphere: "#f0dcbc" }],
  [220, { low: "#9fb0c4", mid: "#dfe3e6", high: "#ffffff", atmosphere: "#dfe9ff" }],
  [330, { low: "#7d95b8", mid: "#c5d2e0", high: "#f2f6fa", atmosphere: "#cfe0ff" }],
  [600, { low: "#1f3f78", mid: "#33609f", high: "#7aa6d6", atmosphere: "#8fb8f0" }],
  [1000, { low: "#1e2433", mid: "#343c52", high: "#5b6680", atmosphere: "#7f8fb5" }],
  [1500, { low: "#1f1220", mid: "#3a2030", high: "#7a4a40", atmosphere: "#ff8a4a" }],
  [2300, { low: "#160c12", mid: "#2a1418", high: "#8c3a2a", atmosphere: "#ff7a3a" }],
];

/**
 * The same for planets like Neptune: methane makes the cold ones blue and
 * cyan, the mild ones have clouds of water, the warm ones lie under a pale
 * haze that hides nearly everything, and the hot ones are dark.
 */
const NEPTUNE_COLORS: [tempK: number, colors: GasColors][] = [
  [60, { low: "#2a4fa8", mid: "#3b6fd6", high: "#8fc4f0", atmosphere: "#8fc4ff" }],
  [130, { low: "#3f8fae", mid: "#62b7cf", high: "#c5eef5", atmosphere: "#b5f0ff" }],
  [250, { low: "#356b93", mid: "#4d8fb8", high: "#e6f0f5", atmosphere: "#a8dcff" }],
  [450, { low: "#6f8086", mid: "#9fb0ae", high: "#d5ddd6", atmosphere: "#cfe0d8" }],
  [750, { low: "#655c9c", mid: "#8f86c4", high: "#cfc6ea", atmosphere: "#cfc0ff" }],
  [1100, { low: "#22193f", mid: "#3a2f6b", high: "#7f6aa8", atmosphere: "#b08cff" }],
  [1800, { low: "#1a1228", mid: "#2e2046", high: "#c75a8a", atmosphere: "#d98cff" }],
];

/**
 * What the haze of a warm planet like Neptune may be made of, which nobody
 * can tell from its temperature: tans like the smog of Titan, grey greens,
 * slate blues. Each such planet leans towards one of them.
 */
const HAZES = ["#c9ae86", "#9fb8a8", "#8ea3c4", "#b9a0c8", "#c8c3b4"];

/** Gas planets whose temperature nobody knows: plain tans and grey blues that claim nothing. */
const UNKNOWN_GIANT: GasColors = { low: "#8a7a62", mid: "#b3a58c", high: "#ddd3c0", atmosphere: "#e6dcc8" };
const UNKNOWN_NEPTUNE: GasColors = { low: "#456886", mid: "#5f86ad", high: "#b9d0e2", atmosphere: "#a8ccee" };

/** The colours for a temperature between two entries of such a list. Temperatures are compared by their ratio. */
function gasColors(stops: [tempK: number, colors: GasColors][], tempK: number): GasColors {
  const last = stops.length - 1;
  if (tempK <= stops[0][0]) return stops[0][1];
  if (tempK >= stops[last][0]) return stops[last][1];
  const upper = stops.findIndex(([temp]) => temp >= tempK);
  const [coolTemp, cool] = stops[upper - 1];
  const [hotTemp, hot] = stops[upper];
  const share = Math.log(tempK / coolTemp) / Math.log(hotTemp / coolTemp);
  return {
    low: mixColors(cool.low, hot.low, share),
    mid: mixColors(cool.mid, hot.mid, share),
    high: mixColors(cool.high, hot.high, share),
    atmosphere: mixColors(cool.atmosphere, hot.atmosphere, share),
  };
}

/** What only the planets of the solar system have: a real map and the real shape and tilt. */
interface SolarSystemLook extends Look {
  banded: boolean;
  /** Winds of the bands, for banded planets. */
  jets?: GlobeSpec["jets"];
  /** Tilt of the axis in degrees. */
  tiltDeg: number;
  /** Negative for the planets that turn backwards. */
  spin?: number;
  /** How much shorter the planet is from pole to pole than across. */
  flattening?: number;
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
    traits: {
      ocean: { color: "#1f4f8f", level: 0 },
      density: 1,
      relief: 0.8,
      aurora: { color: "#58f29a", strength: 0.6 },
    },
  },
  mars: {
    base: "#b5532f",
    layers: [layer("#7c3320", 0.42), layer("#dc9a70", 0.2)],
    atmosphere: "#e8b090",
    banded: false,
    tiltDeg: 25.2,
    // Thin clouds of water ice, which the map of the ground does not show.
    traits: { density: 0.3, relief: 1.2, clouds: { color: "#f4ece6", cover: 0.4 } },
  },
  jupiter: {
    base: "#d2b48c",
    layers: [layer("#a5673f", 0.42), layer("#efe3cd", 0.32)],
    atmosphere: "#f0dcbc",
    banded: true,
    jets: GIANT_JETS,
    tiltDeg: 3.1,
    spin: 1.4,
    flattening: 0.065,
    traits: { density: 0.5, relief: 0, aurora: { color: "#b070ff", strength: 0.8 } },
  },
  saturn: {
    base: "#dcc592",
    layers: [layer("#bfa26a", 0.4), layer("#f1e6c6", 0.3)],
    atmosphere: "#f3e6c0",
    banded: true,
    jets: SATURN_JETS,
    rings: true,
    tiltDeg: 26.7,
    spin: 1.4,
    flattening: 0.098,
    traits: { density: 0.5, relief: 0, aurora: { color: "#b070ff", strength: 0.6 } },
  },
  uranus: {
    base: "#a6dfe3",
    layers: [layer("#8fd0d6", 0.4, 0.7), layer("#c9f0f2", 0.2, 0.6)],
    atmosphere: "#c9f6ff",
    banded: true,
    jets: ICE_GIANT_JETS,
    // Uranus lies on its side.
    tiltDeg: 82,
    spin: -1,
    flattening: 0.023,
    traits: { density: 0.6, relief: 0 },
  },
  neptune: {
    base: "#3558c9",
    layers: [layer("#2742a0", 0.42), layer("#7fa6f0", 0.16, 0.8)],
    atmosphere: "#86aaff",
    banded: true,
    jets: ICE_GIANT_JETS,
    tiltDeg: 28.3,
    flattening: 0.017,
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

/**
 * The colour of the vegetation under a star of this temperature. Plants are
 * the colour of the light they do not use. Under the faint red light of a cool
 * star they would use nearly all of it and look almost black; under a Sun-like
 * star they are green; under a hot star, with blue light to spare, they turn
 * teal and blue. Nobody knows, but this is what the studies of it suggest.
 */
const PLANT_COLORS: [teffK: number, color: string][] = [
  [2600, "#2b2024"],
  [3700, "#3a2d2a"],
  [4800, "#4f5a2c"],
  [5800, "#3f6f45"],
  [6800, "#2f6c62"],
  [8000, "#34588a"],
];

function plantColor(teffK: number | null): string {
  if (teffK === null) return "#3f6f45";
  const last = PLANT_COLORS.length - 1;
  if (teffK <= PLANT_COLORS[0][0]) return PLANT_COLORS[0][1];
  if (teffK >= PLANT_COLORS[last][0]) return PLANT_COLORS[last][1];
  const upper = PLANT_COLORS.findIndex(([teff]) => teff >= teffK);
  const [coolTeff, cool] = PLANT_COLORS[upper - 1];
  const [hotTeff, hot] = PLANT_COLORS[upper];
  return mixColors(cool, hot, (teffK - coolTeff) / (hotTeff - coolTeff));
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

/** Four decimals are finer than a pixel of any picture, and keep the description short on its way to the browser. */
const round = (value: number) => Math.round(value * 10000) / 10000;

/** A turn about the axis by an angle, with east and west or north and south swapped for -1. */
function axisTurn(angle: number, mirrorEast: number, mirrorNorth: number): Turn {
  const c = round(Math.cos(angle));
  const s = round(Math.sin(angle));
  return [mirrorEast * c, 0, -s, 0, mirrorNorth, 0, mirrorEast * s, 0, c];
}

/**
 * Any turn in space, evenly spread over all of them, from three numbers
 * between 0 and 1 (Shoemake's method), and mirrored for -1.
 */
function freeTurn(u1: number, u2: number, u3: number, mirror: number): Turn {
  const a = Math.sqrt(1 - u1);
  const b = Math.sqrt(u1);
  const x = a * Math.sin(2 * Math.PI * u2);
  const y = a * Math.cos(2 * Math.PI * u2);
  const z = b * Math.sin(2 * Math.PI * u3);
  const w = b * Math.cos(2 * Math.PI * u3);
  return [
    mirror * (1 - 2 * (y * y + z * z)),
    2 * (x * y + z * w),
    2 * (x * z - y * w),
    mirror * 2 * (x * y - z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z + x * w),
    mirror * 2 * (x * z + y * w),
    2 * (y * z - x * w),
    1 - 2 * (x * x + y * y),
  ].map(round) as Turn;
}

/**
 * The globe of a look. `rest` holds what does not depend on the look. The
 * parts that only some planets have start switched off; the caller sets them.
 */
function globe(
  look: Look,
  rest: Pick<GlobeSpec, "kind" | "seed" | "light" | "rings" | "tiltDeg" | "spin" | "maps" | "flow" | "jets" | "turn" | "zones" | "flattening">,
): GlobeSpec {
  const traits = look.traits ?? {};
  return {
    palette: traits.palette ?? [look.layers[0].color, look.base, look.layers[1].color],
    ocean: traits.ocean ?? null,
    ice: 0,
    clouds: traits.clouds ?? null,
    glow: traits.glow ?? null,
    aurora: traits.aurora ?? null,
    lightning: 0,
    craters: 0,
    relief: traits.relief ?? 1,
    bands: { ...(traits.bands ?? STRONG_BANDS), storms: 0 },
    atmosphere: look.atmosphere
      ? { color: look.atmosphere, density: traits.density ?? 0.7 }
      : null,
    moon: null,
    locked: 0,
    second: null,
    terrain: NO_TERRAIN,
    belts: NO_BELTS,
    ...rest,
  };
}

/**
 * How firmly a planet is held with one side towards its star: 1 up to an
 * orbit of twelve days, 0 from thirty days on. The pull of a star on a planet
 * this close stops its turning within a small part of its age.
 */
function tidalLock(orbitalPeriodDays: number | null): number {
  if (orbitalPeriodDays === null) return 0;
  return round(Math.min(1, Math.max(0, (30 - orbitalPeriodDays) / 18)));
}

/**
 * What a rocky planet is made of, from how much room its mass takes. A ball
 * of rock like Earth has a radius of about its mass to the power of 0.27 (in
 * Earth's units). One clearly smaller than that is mostly iron, like Mercury;
 * one clearly larger holds much water or ice.
 */
function composition(densityEarth: number | null, radiusEarth: number | null): "iron" | "rock" | "water" {
  if (densityEarth === null || radiusEarth === null) return "rock";
  const rockRadius = (densityEarth * radiusEarth ** 3) ** 0.27;
  const swollen = radiusEarth / rockRadius;
  return swollen < 0.9 ? "iron" : swollen > 1.15 ? "water" : "rock";
}

/** Derives the look of a planet from what is known about it and about its star. */
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
        flattening: sol.flattening ?? 0,
        flow: input.slug === "venus" ? 2 : sol.banded ? 1 : 0,
        jets: sol.jets ?? NO_JETS,
        turn: NO_TURN,
        zones: 1,
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

  // Everything below that is not measured is drawn from the name of the
  // planet, so the same planet always gets the same picture and two planets
  // hardly ever the same one.
  const chance = (what: string) => (hash(`${input.slug}/${what}`) % 10000) / 10000;
  const pick = <T,>(what: string, from: readonly T[]): T =>
    from[Math.floor(chance(what) * from.length)];
  // No two planets have quite the same colours: each moves a little round the
  // colour wheel and is a little greyer or stronger, darker or lighter.
  const hue = (chance("hue") - 0.5) * 30;
  const saturation = 1 + (chance("saturation") - 0.5) * 0.4;
  const lightness = (chance("lightness") - 0.5) * 0.08;
  const own = (color: string) => shade(color, { hue, saturation, lightness });

  const locked = tidalLock(input.orbitalPeriodDays);
  // The real tilt is unknown, so every planet gets its own between 0 and 30
  // degrees. A planet held by its star stands upright.
  let tiltDeg = ((hash(`${input.slug}/tilt`) % 300) / 10) * (1 - locked);
  // A tilted axis gives seasons, and seasons carry warmth towards the poles
  // and rain into the dry belts: fainter climate zones and smaller ice caps.
  const upright = 1 - tiltDeg / 30;
  // 0 at the cold end of the planet's climate class, 1 at the hot end.
  const warmth = climateWarmth(climate, input.eqTempK);
  // Red dwarfs flare, and their storms of particles light up the skies of their planets.
  const flaring = input.starTeffK !== null && input.starTeffK < 4000;
  const light = starLight(input.starTeffK);

  if (gaseous) {
    const giant = input.planetClass === "gas_giant";
    const tempK = input.eqTempK;
    const measured =
      tempK === null
        ? giant
          ? UNKNOWN_GIANT
          : UNKNOWN_NEPTUNE
        : gasColors(giant ? GIANT_COLORS : NEPTUNE_COLORS, tempK);
    // The haze of a warm planet like Neptune hides its belts and gives it its colour.
    const hazy = !giant && tempK !== null && tempK > 350 && tempK < 900;
    const haze = pick("haze", HAZES);
    const veiled = (color: string, share: number) => own(hazy ? mixColors(color, haze, share) : color);
    const colors: GasColors = {
      low: veiled(measured.low, 0.45),
      mid: veiled(measured.mid, 0.6),
      high: veiled(measured.high, 0.5),
      atmosphere: veiled(measured.atmosphere, 0.5),
    };
    const preset = pick(
      "preset",
      giant
        ? tempK !== null && tempK > 1000
          ? HOT_GIANT_PRESETS
          : GIANT_PRESETS
        : hazy
          ? HAZY_NEPTUNE_PRESETS
          : NEPTUNE_PRESETS,
    );
    // From about 900 kelvin a giant begins to glow by itself, dull red at
    // first, brighter and more orange the hotter it is.
    const heat = tempK === null ? 0 : Math.min(1, Math.max(0, (tempK - 900) / 1500));
    const glow =
      heat > 0
        ? {
            color: giant ? mixColors("#e0401a", "#ffa040", heat) : mixColors("#a8306a", "#e0609a", heat),
            strength: round(0.1 + 0.75 * heat),
          }
        : null;
    // Rings and moons do not last close to a star, and a planet held by its
    // star turns too slowly to be flattened.
    const free = locked < 0.5;
    const cool = tempK === null || tempK < 300;
    const ringed = free && chance("rings") < (cool ? 0.22 : 0.06);
    const inner = 1.25 + 0.3 * chance("rings/inner");
    if (ringed) tiltDeg = Math.max(tiltDeg, 12);
    const moon = free && !ringed && chance("moon") < 0.3;
    // The winds the preset was simulated with: they blow on, so the clouds
    // keep drifting the way they were drawn out.
    const winds = PRESETS.bands[preset];
    const look: Look = {
      base: colors.mid,
      layers: [layer(colors.low, 0.45), layer(colors.high, giant ? 0.3 : 0.2, giant ? 1 : 0.8)],
      atmosphere: colors.atmosphere,
      traits: {
        glow,
        bands: {
          contrast: round((giant ? 0.8 + 0.3 * chance("contrast") : 0.45 + 0.25 * chance("contrast")) * (hazy ? 0.6 : 1)),
          turbulence: round(giant ? 0.7 + 0.3 * chance("streaks") : 0.5 + 0.2 * chance("streaks")),
        },
        aurora:
          chance("aurora") < 0.35
            ? {
                color: mixColors("#b070ff", "#ff6aa0", chance("aurora/colour")),
                strength: round((flaring ? 0.7 : 0.4) + 0.4 * chance("aurora/strength")),
              }
            : null,
      },
    };
    const bands = globe(look, {
      kind: "bands",
      seed,
      light,
      rings: ringed ? { inner: round(inner), outer: round(inner + 0.45 + 0.5 * chance("rings/outer")), map: null } : null,
      tiltDeg,
      // Gas giants turn fast. One held by its star does not, but its winds
      // carry the clouds around it at about half that pace.
      spin: round(1.3 * (1 - 0.5 * locked)),
      flattening: round((giant ? 0.03 + 0.07 * chance("flattening") : 0.01 + 0.03 * chance("flattening")) * (1 - locked)),
      maps: { day: preset, night: null, clouds: null },
      flow: 1,
      jets: [winds.strength, winds.count, winds.equator, winds.narrowness],
      turn: axisTurn(chance("turn") * Math.PI * 2, chance("mirror-x") < 0.5 ? -1 : 1, chance("mirror-y") < 0.5 ? -1 : 1),
      zones: 1,
    });
    return {
      base: look.base,
      layers: look.layers,
      atmosphere: look.atmosphere,
      banded: true,
      rings: ringed,
      starTint: starTint(input.starTeffK),
      seed,
      globe: {
        ...bands,
        locked,
        bands: { ...bands.bands, storms: round(0.4 + 0.6 * chance("storms")) },
        // Between two thirds and all of the latitudes: wider or narrower belts.
        belts: [round(0.64 + 0.36 * chance("belts")), winds.phase],
        // Thunderstorms need clouds; the hottest giants have none of water.
        lightning: (tempK === null || tempK < 1500) && chance("lightning") < 0.35 ? round(0.4 + 0.6 * chance("lightning/rate")) : 0,
        moon: moon
          ? {
              size: round(0.04 + 0.06 * chance("moon/size")),
              distance: round(1.2 + 0.15 * chance("moon/distance")),
              period: round(14 + 20 * chance("moon/period")),
              phase: round(chance("moon/phase") * Math.PI * 2),
            }
          : null,
      },
    };
  }

  const made = composition(input.densityEarth, input.radiusEarth);
  const solid = SOLID[climate];
  // A world of iron is darker and greyer than one of rock.
  const rock = (color: string) =>
    made === "iron" ? shade(own(color), { saturation: 0.5, lightness: -0.06 }) : own(color);
  // Plants take the colour that makes the most of their star's light.
  const plants = climate === "temperate" ? plantColor(input.starTeffK) : null;
  const traits = solid.traits ?? {};
  const palette: GlobeSpec["palette"] = traits.palette
    ? [plants ?? rock(traits.palette[0]), rock(traits.palette[1]), rock(traits.palette[2])]
    : [rock(solid.layers[0].color), rock(solid.base), rock(solid.layers[1].color)];
  const look: Look = {
    // The sea of a mild world and the lava of a molten one keep their own colours.
    base: climate === "temperate" ? own(solid.base) : rock(solid.base),
    layers: solid.layers.map((item, index) => ({
      ...item,
      color:
        index === 0 && plants
          ? plants
          : climate === "scorching" && index > 0
            ? item.color
            : rock(item.color),
    })),
    atmosphere: solid.atmosphere && own(solid.atmosphere),
    traits: {
      ...traits,
      palette,
      ocean: traits.ocean && { ...traits.ocean, color: own(traits.ocean.color) },
    },
  };

  const list = TERRAIN_PRESETS[climate];
  // Much water on a cold world freezes to a shell of ice.
  const preset = made === "water" && (climate === "cold" || climate === "frozen") ? "icecrust" : pick("preset", list);
  const others = list.filter((name) => name !== preset);
  const second = others.length > 0 ? pick("second", others) : null;
  const base = globe(look, {
    kind: "terrain",
    seed,
    light,
    rings: null,
    tiltDeg,
    spin: round(1 - locked),
    flattening: 0,
    maps: { day: preset, night: null, clouds: null },
    flow: 0,
    jets: NO_JETS,
    turn: freeTurn(chance("turn"), chance("turn/2"), chance("turn/3"), chance("mirror") < 0.5 ? -1 : 1),
    // A planet held by its star has one climate for good at every place.
    zones: round(locked + (1 - locked) * (0.4 + 0.6 * upright)),
  });
  // A planet twice as wide as Earth pulls much harder: lower mountains.
  const radius = input.radiusEarth ?? 1;
  const relief = Math.min(1.3, Math.max(0.6, 1.25 - 0.35 * (radius - 1)));
  const icy = preset === "icecrust";
  // The height below which this share of the surface lies, across both presets.
  const levelAt = (share: number) =>
    round(second ? (presetLevel(preset, share) + presetLevel(second, share)) / 2 : presetLevel(preset, share));
  const level =
    climate === "scorching"
      ? // From lava in the deepest basins to lava over two thirds of the planet.
        levelAt(0.15 + 0.45 * warmth + 0.1 * chance("lava"))
      : climate === "temperate" || icy
        ? 0
        : levelAt(0.15 + 0.25 * chance("basins"));
  const cool = 1 - warmth;
  // Size of the ice caps, share of sky with clouds and glow of the lava, by
  // temperature. On a planet held by its star the ice covers the night side.
  const caps =
    climate === "temperate"
      ? 0.04 + 0.2 * cool
      : climate === "cold"
        ? 0.1 + 0.22 * cool
        : climate === "frozen"
          ? 0.24 + 0.2 * cool
          : 0;
  const nightIce = climate === "temperate" ? 0.42 + 0.14 * cool : climate === "cold" ? 0.52 + 0.1 * cool : caps;
  const ice = caps * (0.65 + 0.5 * upright) * (1 - locked) + nightIce * locked;
  // A hot world with much water lies under a deck of steam.
  const steamy = made === "water" && climate === "hot";
  const cover = steamy
    ? 0.85
    : climate === "temperate"
      ? 0.4 + 0.2 * warmth
      : climate === "cold"
        ? 0.05 + 0.1 * warmth
        : climate === "frozen"
          ? 0.06 + 0.1 * warmth
          : climate === "hot"
            ? 0.1 + 0.16 * warmth
            : 0;
  const glow =
    climate === "scorching"
      ? // Rock that has just melted glows red, hotter lava orange.
        { color: mixColors("#e0401a", "#ffa040", warmth), strength: round(0.7 + 0.5 * warmth) }
      : climate === "hot" && warmth > 0.7
        ? // Near the melting point of rock the lowest plains begin to glow.
          { color: "#ff5a1f", strength: round(((warmth - 0.7) / 0.3) * 0.4) }
        : null;
  // A warm world has less water locked in ice, so its seas stand higher. A
  // world of water is nearly all sea.
  const sea =
    made === "water"
      ? 0.93 + 0.06 * chance("sea")
      : Math.min(0.9, Math.max(0.3, 0.45 + 0.4 * chance("sea") + (warmth - 0.5) * 0.12));
  const free = locked < 0.5;
  const moon = free && chance("moon") < 0.15;
  const aurora =
    base.atmosphere && chance("aurora") < (flaring ? 0.7 : 0.3)
      ? {
          // Green like the oxygen of Earth where plants could grow, else the pinks and blues of other gases.
          color: plants ? "#58f29a" : mixColors("#7fd0ff", "#ff8ad0", chance("aurora/colour")),
          strength: round((flaring ? 0.8 : 0.45) + 0.4 * chance("aurora/strength")),
        }
      : null;
  return {
    base: look.base,
    layers: look.layers,
    atmosphere: look.atmosphere,
    banded: false,
    rings: false,
    starTint: starTint(input.starTeffK),
    seed,
    globe: {
      ...base,
      locked,
      second: second && {
        map: second,
        turn: freeTurn(chance("second/turn"), chance("second/turn/2"), chance("second/turn/3"), chance("second/mirror") < 0.5 ? -1 : 1),
      },
      ice: round(ice),
      clouds: base.clouds && { ...base.clouds, cover: round(cover) },
      atmosphere: base.atmosphere && steamy ? { ...base.atmosphere, density: 1 } : base.atmosphere,
      glow,
      aurora,
      // Between a little under half and most of the surface is sea.
      ocean: base.ocean && { ...base.ocean, level: levelAt(sea) },
      craters: round(Math.min(1, TERRAIN_CRATERS[preset] * (climate === "temperate" ? 0.4 : 1) * (made === "iron" ? 1.3 : 1))),
      terrain: [
        level,
        climate === "temperate" ? 1 : climate === "cold" || climate === "hot" ? 0.7 : 0,
        round(relief * (icy ? 0.6 : 1)),
        icy ? 1 : 0,
      ],
      moon: moon
        ? {
            size: round(0.08 + 0.12 * chance("moon/size")),
            distance: round(1.22 + 0.15 * chance("moon/distance")),
            period: round(14 + 20 * chance("moon/period")),
            phase: round(chance("moon/phase") * Math.PI * 2),
          }
        : null,
    },
  };
}

/** The temperatures in kelvin between which each climate class lies (classify.ts), with ends for the open ones. */
const CLIMATE_RANGE: Record<ClimateClass, [number, number]> = {
  frozen: [50, 150],
  cold: [150, 250],
  temperate: [250, 350],
  hot: [350, 1000],
  scorching: [1000, 2500],
};

/**
 * Where a temperature lies within its climate class: 0 at the cold end, 1 at
 * the hot end, 0.5 when the temperature is not known. Hot worlds span a wide
 * range, so they are measured by the ratio of temperatures.
 */
function climateWarmth(climate: ClimateClass | "unknown", eqTempK: number | null): number {
  if (climate === "unknown" || eqTempK === null) return 0.5;
  const [low, high] = CLIMATE_RANGE[climate];
  const share =
    climate === "hot"
      ? Math.log(eqTempK / low) / Math.log(high / low)
      : (eqTempK - low) / (high - low);
  return Math.min(1, Math.max(0, share));
}

/** The height (0 to 1) below which the given share of the surface of a preset lies. */
function presetLevel(preset: Preset, share: number): number {
  const levels = PRESETS.terrain[preset].levels;
  const at = Math.min(0.9999, Math.max(0, share)) * (levels.length - 1);
  const index = Math.floor(at);
  return levels[index] + (levels[index + 1] - levels[index]) * (at - index);
}
