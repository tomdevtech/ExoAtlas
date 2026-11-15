import { describe, expect, it } from "vitest";
import { planetAppearance } from "../appearance";
import { globeRadius, globeRotation, lightDirection, linearColor, seedOffset, type GlobeSpec } from "./spec";
import {
  ALL_SURFACE_DEFINES,
  defineLines,
  surfaceDefines,
  surfaceUniforms,
  textureUrls,
} from "./uniforms";

function globe(slug: string, source: "nasa" | "sol" = "sol"): GlobeSpec {
  return planetAppearance({
    slug,
    source,
    planetClass: "rocky",
    climateClass: "temperate",
    starTeffK: 5772,
  }).globe;
}

/** Applies a rotation of nine numbers, row by row, to a direction. */
function turn(matrix: number[], [x, y, z]: number[]): number[] {
  return [
    matrix[0] * x + matrix[1] * y + matrix[2] * z,
    matrix[3] * x + matrix[4] * y + matrix[5] * z,
    matrix[6] * x + matrix[7] * y + matrix[8] * z,
  ];
}

describe("linearColor", () => {
  it("maps black and white to the ends of the range", () => {
    expect(linearColor("#000000")).toEqual([0, 0, 0]);
    expect(linearColor("#ffffff")).toEqual([1, 1, 1]);
  });

  it("reads the three channels in the order red, green, blue", () => {
    const [red, green, blue] = linearColor("#ff8000");
    expect(red).toBe(1);
    expect(green).toBeCloseTo((128 / 255) ** 2.2, 9);
    expect(blue).toBe(0);
  });
});

describe("seedOffset", () => {
  it("gives different seeds different places in the noise", () => {
    expect(seedOffset(12)).toEqual(seedOffset(12));
    expect(seedOffset(12)).not.toEqual(seedOffset(13));
  });
});

describe("globeRadius", () => {
  it("shrinks a ringed planet so that its rings fit into the picture", () => {
    const earth = globe("earth");
    const saturn = globe("saturn");
    expect(globeRadius(earth)).toBe(0.84);
    expect(saturn.rings).not.toBeNull();
    expect(globeRadius(saturn) * saturn.rings!.outer).toBeCloseTo(0.84, 9);
  });
});

describe("globeRotation", () => {
  it("only turns: lengths and right angles stay", () => {
    const m = globeRotation(globe("earth"), 12.3, 0.4, -0.2);
    const rows = [m.slice(0, 3), m.slice(3, 6), m.slice(6, 9)];
    for (const row of rows) expect(Math.hypot(...row)).toBeCloseTo(1, 9);
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    expect(dot(rows[0], rows[1])).toBeCloseTo(0, 9);
    expect(dot(rows[0], rows[2])).toBeCloseTo(0, 9);
    expect(dot(rows[1], rows[2])).toBeCloseTo(0, 9);
  });

  it("spins the planet around its axis, which stays where it is", () => {
    const spec = globe("earth");
    const now = globeRotation(spec, 0);
    const later = globeRotation(spec, 7);
    const axisNow = turn(now, [0, 1, 0]);
    const axisLater = turn(later, [0, 1, 0]);
    axisNow.forEach((value, i) => expect(axisLater[i]).toBeCloseTo(value, 9));
    expect(turn(later, [1, 0, 0])[0]).not.toBeCloseTo(turn(now, [1, 0, 0])[0], 3);
  });

  it("is back where it started after one turn", () => {
    const spec = { ...globe("earth"), spin: 1 };
    const start = globeRotation(spec, 0);
    const end = globeRotation(spec, 40);
    start.forEach((value, i) => expect(end[i]).toBeCloseTo(value, 9));
  });

  it("turns planets with a negative spin the other way", () => {
    const forwards = { ...globe("earth"), spin: 1 };
    const backwards = { ...forwards, spin: -1 };
    const a = globeRotation(forwards, 3);
    const b = globeRotation(backwards, -3);
    a.forEach((value, i) => expect(b[i]).toBeCloseTo(value, 9));
  });
});

describe("lightDirection", () => {
  it("has the length 1 and comes from the upper left front", () => {
    const [x, y, z] = lightDirection();
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 9);
    expect(x).toBeLessThan(0);
    expect(y).toBeGreaterThan(0);
    expect(z).toBeGreaterThan(0);
  });

  it("moves with the camera", () => {
    expect(lightDirection(1, 0)).not.toEqual(lightDirection());
    expect(Math.hypot(...lightDirection(1, 0.5))).toBeCloseTo(1, 9);
  });
});

describe("surfaceDefines", () => {
  const gas = () =>
    planetAppearance({
      slug: "some-c",
      source: "nasa",
      planetClass: "gas_giant",
      climateClass: "hot",
      starTeffK: 6000,
    }).globe;

  it("tells the shader which kind of surface to draw", () => {
    expect(surfaceDefines(globe("earth")).KIND).toBe(2);
    expect(surfaceDefines(globe("some-b", "nasa")).KIND).toBe(0);
    expect(surfaceDefines(gas()).KIND).toBe(1);
  });

  it("leaves out relief and craters where a planet has none", () => {
    const solid = globe("some-b", "nasa");
    expect(surfaceDefines({ ...solid, relief: 1, craters: 0.5 })).toMatchObject({
      RELIEF: 1,
      CRATERS: 1,
    });
    expect(surfaceDefines({ ...solid, relief: 0, craters: 0 })).toMatchObject({
      RELIEF: 0,
      CRATERS: 0,
    });
    // Gas has no ground, a map has no computed craters.
    expect(surfaceDefines({ ...gas(), relief: 1, craters: 1 })).toMatchObject({
      RELIEF: 0,
      CRATERS: 0,
    });
    expect(surfaceDefines({ ...globe("earth"), craters: 1 }).CRATERS).toBe(0);
  });

  it("only returns combinations the warm-up knows", () => {
    const keys = new Set(ALL_SURFACE_DEFINES.map(defineLines));
    for (const kind of ["solid", "gas", "map"] as const) {
      for (const relief of [0, 1]) {
        for (const craters of [0, 1]) {
          const spec = { ...globe("some-b", "nasa"), kind, relief, craters };
          expect(keys.has(defineLines(surfaceDefines(spec)))).toBe(true);
        }
      }
    }
  });
});

describe("surfaceUniforms", () => {
  it("switches off what a planet does not have", () => {
    const bare: GlobeSpec = {
      ...globe("some-b", "nasa"),
      ocean: null,
      clouds: null,
      glow: null,
      atmosphere: null,
      rings: null,
    };
    const uniforms = surfaceUniforms(bare);
    expect(uniforms.uOcean[3]).toBeLessThan(-1);
    expect(uniforms.uCloud[3]).toBe(0);
    expect(uniforms.uGlow[3]).toBe(0);
    expect(uniforms.uAtmo[3]).toBe(0);
    expect(uniforms.uRing[2]).toBe(0);
    expect(uniforms.uMapFlags).toEqual([0, 0, 0, 0]);
  });

  it("announces the extra maps of Earth and the ring map of Saturn", () => {
    const earth = surfaceUniforms(globe("earth")).uMapFlags;
    expect(earth[0]).toBe(1);
    expect(earth[1]).toBe(1);
    expect(surfaceUniforms(globe("saturn")).uMapFlags[2]).toBe(1);
  });
});

describe("textureUrls", () => {
  it("names the files of a planet of the solar system", () => {
    expect(textureUrls(globe("earth"), "lg")).toEqual({
      day: "/textures/planets/earth-lg.jpg",
      night: "/textures/planets/earth-night-lg.jpg",
      clouds: "/textures/planets/earth-clouds-lg.jpg",
      ring: null,
    });
    expect(textureUrls(globe("saturn"), "sm")).toMatchObject({
      day: "/textures/planets/saturn-sm.jpg",
      ring: "/textures/planets/saturn-ring.png",
    });
  });

  it("names no files for a computed planet", () => {
    expect(textureUrls(globe("some-b", "nasa"), "sm")).toEqual({
      day: null,
      night: null,
      clouds: null,
      ring: null,
    });
  });
});
