import { linearColor, seedOffset, type GlobeSpec } from "./spec";

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
}

const KIND = { solid: 0, gas: 1, map: 2 } as const;

/**
 * The parts of surface.glsl.ts a planet needs, as values for #define. Every
 * combination is a program of its own, so a planet only compiles its own code.
 */
export interface SurfaceDefines {
  /** 0 solid, 1 gas, 2 map. */
  KIND: 0 | 1 | 2;
  /** 1 when heights catch the light. Gas planets have no heights. */
  RELIEF: 0 | 1;
  /** 1 for a solid planet with craters. */
  CRATERS: 0 | 1;
}

export function surfaceDefines(spec: GlobeSpec): SurfaceDefines {
  return {
    KIND: KIND[spec.kind],
    RELIEF: spec.relief > 0 && spec.kind !== "gas" ? 1 : 0,
    CRATERS: spec.craters > 0 && spec.kind === "solid" ? 1 : 0,
  };
}

/** Every combination that surfaceDefines can return. */
export const ALL_SURFACE_DEFINES: SurfaceDefines[] = [
  { KIND: 0, RELIEF: 1, CRATERS: 0 },
  { KIND: 0, RELIEF: 1, CRATERS: 1 },
  { KIND: 0, RELIEF: 0, CRATERS: 0 },
  { KIND: 0, RELIEF: 0, CRATERS: 1 },
  { KIND: 1, RELIEF: 0, CRATERS: 0 },
  { KIND: 2, RELIEF: 1, CRATERS: 0 },
  { KIND: 2, RELIEF: 0, CRATERS: 0 },
];

/** The #define lines for a shader, which also serve as the name of its program. */
export function defineLines(defines: SurfaceDefines): string {
  return (
    `#define KIND ${defines.KIND}\n` +
    `#define RELIEF ${defines.RELIEF}\n` +
    `#define CRATERS ${defines.CRATERS}\n`
  );
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
      spec.maps?.night ? 1 : 0,
      spec.maps?.clouds ? 1 : 0,
      spec.rings?.map ? 1 : 0,
      spec.maps && spec.ocean ? 1 : 0,
    ],
  };
}

/** Where the files of a planet's maps are. The small ones are for lists, the large ones for the 3D model. */
export function textureUrls(
  spec: GlobeSpec,
  size: "sm" | "lg",
): { day: string | null; night: string | null; clouds: string | null; ring: string | null } {
  const url = (name: string | null | undefined) =>
    name ? `/textures/planets/${name}-${size}.jpg` : null;
  return {
    day: url(spec.maps?.day),
    night: url(spec.maps?.night),
    clouds: url(spec.maps?.clouds),
    ring: spec.rings?.map ? `/textures/planets/${spec.rings.map}.png` : null,
  };
}
