import { linearColor, NO_TURN, seedOffset, type GlobeSpec, type Turn } from "./spec";

type Vec2 = [number, number];
type Vec3 = [number, number, number];
type Vec4 = [number, number, number, number];

/** The values for the uniforms of surface.glsl.ts, except the textures and the time. */
export interface SurfaceUniforms {
  uSeed: Vec3;
  uColLow: Vec3;
  uColMid: Vec3;
  uColHigh: Vec3;
  uOcean: Vec4;
  uIce: number;
  uCloud: Vec4;
  uGlow: Vec4;
  uCraters: number;
  uRelief: number;
  uBands: Vec3;
  uAtmo: Vec4;
  uLight: Vec3;
  uRing: Vec3;
  uMapFlags: Vec4;
  uFlow: number;
  uJets: Vec4;
  uZones: number;
  uLocked: number;
  uMapTurn: Turn;
  uMapTurn2: Turn;
  uTerrain: Vec4;
  uBelts: Vec2;
  uAurora: Vec4;
  uLightning: number;
  uStormSpin: number;
  /** Six storms of four numbers each, unused ones all 0. */
  uGiantStorms: number[];
}

const KIND = { map: 0, terrain: 1, bands: 2 } as const;

/** How many storms of a gas planet the shader can turn (uGiantStorms). */
export const GIANT_STORMS = 6;

/**
 * The parts of surface.glsl.ts a planet needs, as values for #define. Every
 * combination is a program of its own, so a planet only compiles its own code.
 */
export interface SurfaceDefines {
  /** 0 map, 1 terrain preset, 2 band preset. */
  KIND: 0 | 1 | 2;
  /** 1 when heights catch the light. */
  RELIEF: 0 | 1;
}

export function surfaceDefines(spec: GlobeSpec): SurfaceDefines {
  return {
    KIND: KIND[spec.kind],
    // Terrain always has heights, bands never. Maps of gas planets have none either.
    RELIEF: spec.kind === "terrain" || (spec.kind === "map" && spec.relief > 0) ? 1 : 0,
  };
}

/** Every combination that surfaceDefines can return. */
export const ALL_SURFACE_DEFINES: SurfaceDefines[] = [
  { KIND: 0, RELIEF: 1 },
  { KIND: 0, RELIEF: 0 },
  { KIND: 1, RELIEF: 1 },
  { KIND: 2, RELIEF: 0 },
];

/** The #define lines for a shader, which also serve as the name of its program. */
export function defineLines(defines: SurfaceDefines): string {
  return `#define KIND ${defines.KIND}\n#define RELIEF ${defines.RELIEF}\n`;
}

/** Translates the description of a planet into the numbers the shader reads. */
export function surfaceUniforms(spec: GlobeSpec): SurfaceUniforms {
  return {
    uSeed: seedOffset(spec.seed),
    uColLow: linearColor(spec.palette[0]),
    uColMid: linearColor(spec.palette[1]),
    uColHigh: linearColor(spec.palette[2]),
    // A level far below every height means: no ocean.
    uOcean: spec.ocean ? [...linearColor(spec.ocean.color), spec.ocean.level] : [0, 0, 0, -10],
    uIce: spec.ice,
    uCloud: spec.clouds ? [...linearColor(spec.clouds.color), spec.clouds.cover] : [1, 1, 1, 0],
    uGlow: spec.glow ? [...linearColor(spec.glow.color), spec.glow.strength] : [0, 0, 0, 0],
    uCraters: spec.craters,
    uRelief: spec.relief,
    uBands: [spec.bands.contrast, spec.bands.turbulence, spec.bands.storms],
    uAtmo: spec.atmosphere
      ? [...linearColor(spec.atmosphere.color), spec.atmosphere.density]
      : [0, 0, 0, 0],
    uLight: linearColor(spec.light),
    uRing: spec.rings ? [spec.rings.inner, spec.rings.outer, 1] : [0, 0, 0],
    uMapFlags: [
      spec.maps.night || spec.second ? 1 : 0,
      spec.maps.clouds ? 1 : 0,
      spec.rings?.map ? 1 : 0,
      spec.ocean ? 1 : 0,
    ],
    uFlow: spec.flow,
    uJets: spec.jets,
    uZones: spec.zones,
    uLocked: spec.locked,
    uMapTurn: spec.turn,
    uMapTurn2: spec.second?.turn ?? NO_TURN,
    uTerrain: spec.terrain,
    uBelts: spec.belts,
    uAurora: spec.aurora ? [...linearColor(spec.aurora.color), spec.aurora.strength] : [0, 0, 0, 0],
    uLightning: spec.lightning,
    // The storms that come and go depend on the time: see stormUniforms in storms.ts.
    uStormSpin: spec.storms.spin,
    uGiantStorms: Array.from({ length: GIANT_STORMS }, (_, index) => spec.giantStorms[index] ?? [0, 0, 0, 0]).flat(),
  };
}

/**
 * Where the files of a planet's maps are. The small ones are for lists, the
 * large ones for the 3D model. `night` is the map of the lights at night, or
 * for a `terrain` its second preset: the shader reads both from the same place.
 */
export function textureUrls(
  spec: GlobeSpec,
  size: "sm" | "lg",
): { day: string; night: string | null; clouds: string | null; ring: string | null } {
  const url = (name: string | null) => (name ? `/textures/planets/${name}-${size}.jpg` : null);
  const preset = (name: string) => `/textures/presets/${name}-${size}.webp`;
  return {
    day: spec.kind === "map" ? `/textures/planets/${spec.maps.day}-${size}.jpg` : preset(spec.maps.day),
    night: spec.second ? preset(spec.second.map) : url(spec.maps.night),
    clouds: url(spec.maps.clouds),
    ring: spec.rings?.map ? `/textures/planets/${spec.rings.map}.png` : null,
  };
}
