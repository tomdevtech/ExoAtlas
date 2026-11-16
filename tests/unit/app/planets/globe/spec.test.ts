import { describe, expect, it } from "vitest";
import { planetAppearance } from "@/app/planets/appearance";
import {
  globeRadius,
  globeRotation,
  lightDirection,
  linearColor,
  lockedSway,
  moonPosition,
  seedOffset,
  type GlobeSpec,
} from "@/app/planets/globe/spec";
import {
  ALL_SURFACE_DEFINES,
  defineLines,
  surfaceDefines,
  surfaceUniforms,
  textureUrls,
} from "@/app/planets/globe/uniforms";

function globe(slug: string, source: "nasa" | "sol" = "sol"): GlobeSpec {
  return planetAppearance({
    slug,
    source,
    planetClass: "rocky",
    climateClass: "temperate",
    starTeffK: 5772,
    radiusEarth: null,
    eqTempK: null,
    densityEarth: null,
    orbitalPeriodDays: null,
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

  it("leaves room for a moon", () => {
    const moon = { size: 0.1, distance: 1.3, period: 20, phase: 0 };
    expect(globeRadius({ ...globe("earth"), moon }) * 1.4).toBeCloseTo(0.84, 9);
  });
});

describe("moonPosition", () => {
  const moon = { size: 0.1, distance: 1.3, period: 20, phase: 0.4 };

  it("keeps the moon on its orbit and brings it back after one round", () => {
    const spec = { ...globe("earth"), moon };
    for (const seconds of [0, 3, 11.5]) {
      expect(Math.hypot(...moonPosition(spec, seconds)!)).toBeCloseTo(1.3, 9);
    }
    const start = moonPosition(spec, 0)!;
    moonPosition(spec, 20)!.forEach((value, i) => expect(value).toBeCloseTo(start[i], 9));
    expect(moonPosition(spec, 5)![0]).not.toBeCloseTo(start[0], 3);
  });

  it("lays the orbit above the equator of the planet", () => {
    const spec = { ...globe("earth"), moon };
    // The axis as the viewer sees it is the middle column of the rotation.
    const rotation = globeRotation(spec, 0);
    const axis = [rotation[1], rotation[4], rotation[7]];
    const position = moonPosition(spec, 7)!;
    expect(axis[0] * position[0] + axis[1] * position[1] + axis[2] * position[2]).toBeCloseTo(0, 9);
  });

  it("is nothing without a moon", () => {
    expect(moonPosition(globe("earth"), 3)).toBeNull();
  });
});

describe("lockedSway", () => {
  it("swings the view around a planet that cannot turn, and leaves the others alone", () => {
    const free = globe("some-b", "nasa");
    const held = { ...free, locked: 1 };
    expect(lockedSway(free, 13)).toBe(0);
    // The clouds of a gas planet circle it whether it is held or not: nothing to swing around.
    expect(lockedSway({ ...held, kind: "bands" }, 13)).toBe(0);
    const angles = Array.from({ length: 200 }, (_, second) => lockedSway(held, second));
    expect(Math.max(...angles)).toBeGreaterThan(0.6);
    expect(Math.min(...angles)).toBeLessThan(-0.6);
    // Never so far that the viewer looks at the night side only.
    for (const angle of angles) expect(Math.abs(angle)).toBeLessThan(1);
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
      radiusEarth: null,
      eqTempK: null,
      densityEarth: null,
      orbitalPeriodDays: null,
    }).globe;

  it("tells the shader which kind of surface to draw", () => {
    expect(surfaceDefines(globe("earth")).KIND).toBe(0);
    expect(surfaceDefines(globe("some-b", "nasa")).KIND).toBe(1);
    expect(surfaceDefines(gas()).KIND).toBe(2);
  });

  it("leaves out relief where a planet has no heights", () => {
    // A map takes its heights from the picture, where it shows ground.
    expect(surfaceDefines({ ...globe("earth"), relief: 0.8 }).RELIEF).toBe(1);
    expect(surfaceDefines(globe("jupiter")).RELIEF).toBe(0);
    // A terrain preset is nothing but heights, gas has no ground.
    expect(surfaceDefines({ ...globe("some-b", "nasa"), relief: 0 }).RELIEF).toBe(1);
    expect(surfaceDefines({ ...gas(), relief: 1 }).RELIEF).toBe(0);
  });

  it("returns exactly the combinations the warm-up builds", () => {
    const built = ALL_SURFACE_DEFINES.map(defineLines);
    expect(new Set(built).size).toBe(built.length);
    const returned = new Set<string>();
    for (const spec of [globe("earth"), globe("some-b", "nasa"), gas()]) {
      for (const relief of [0, 1]) returned.add(defineLines(surfaceDefines({ ...spec, relief })));
    }
    expect(returned).toEqual(new Set(built));
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
      second: null,
      aurora: null,
    };
    const uniforms = surfaceUniforms(bare);
    expect(uniforms.uOcean[3]).toBeLessThan(-1);
    expect(uniforms.uCloud[3]).toBe(0);
    expect(uniforms.uGlow[3]).toBe(0);
    expect(uniforms.uAtmo[3]).toBe(0);
    expect(uniforms.uRing[2]).toBe(0);
    expect(uniforms.uAurora[3]).toBe(0);
    expect(uniforms.uMapFlags).toEqual([0, 0, 0, 0]);
    // Nothing to turn: the second preset keeps the place of the first.
    expect(uniforms.uMapTurn2).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it("hands every part of the description to the shader unchanged", () => {
    const giant = planetAppearance({
      slug: "hot-b",
      source: "nasa",
      planetClass: "gas_giant",
      climateClass: "hot",
      starTeffK: 6000,
      radiusEarth: null,
      eqTempK: null,
      densityEarth: null,
      orbitalPeriodDays: null,
    }).globe;
    const uniforms = surfaceUniforms(giant);
    expect(uniforms.uFlow).toBe(giant.flow);
    expect(uniforms.uJets).toEqual(giant.jets);
    expect(uniforms.uBelts).toEqual(giant.belts);
    expect(uniforms.uBands).toEqual([giant.bands.contrast, giant.bands.turbulence, giant.bands.storms]);
    const rocky = globe("some-b", "nasa");
    expect(surfaceUniforms(rocky).uTerrain).toEqual(rocky.terrain);
    expect(surfaceUniforms(rocky).uMapTurn).toEqual(rocky.turn);
    expect(surfaceUniforms(rocky).uMapTurn2).toEqual(rocky.second?.turn);
    // The second preset takes the place of the map of the night.
    expect(surfaceUniforms(rocky).uMapFlags[0]).toBe(1);
    expect(surfaceUniforms(rocky).uZones).toBe(rocky.zones);
    expect(surfaceUniforms({ ...rocky, locked: 1 }).uLocked).toBe(1);
    expect(surfaceUniforms({ ...giant, lightning: 0.7 }).uLightning).toBe(0.7);
    const lights = surfaceUniforms({ ...rocky, aurora: { color: "#ffffff", strength: 0.5 } }).uAurora;
    expect(lights).toEqual([1, 1, 1, 0.5]);
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

  it("names the preset of an exoplanet", () => {
    const rocky = globe("some-b", "nasa");
    expect(textureUrls(rocky, "sm")).toEqual({
      day: `/textures/presets/${rocky.maps.day}-sm.webp`,
      night: `/textures/presets/${rocky.second?.map}-sm.webp`,
      clouds: null,
      ring: null,
    });
    const giant = planetAppearance({
      slug: "hot-b",
      source: "nasa",
      planetClass: "gas_giant",
      climateClass: "hot",
      starTeffK: 6000,
      radiusEarth: null,
      eqTempK: null,
      densityEarth: null,
      orbitalPeriodDays: null,
    }).globe;
    expect(textureUrls(giant, "lg").day).toMatch(/^\/textures\/presets\/bands-[a-z]+-lg\.webp$/);
  });
});
