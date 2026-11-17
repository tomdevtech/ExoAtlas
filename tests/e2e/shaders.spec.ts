import path from "node:path";
import sharp from "sharp";
import { GALAXY_PICTURE_WIDTH } from "@/app/map/galaxy";
import * as map from "@/app/map/scene/shaders";
import { planetAppearance, type AppearanceInput } from "@/app/planets/appearance";
import { globeFragment, GLOBE_VERTEX } from "@/app/planets/globe/globe.glsl";
import { globeRadius, type GlobeSpec } from "@/app/planets/globe/spec";
import { stormUniforms } from "@/app/planets/globe/storms";
import { ALL_SURFACE_DEFINES, defineLines } from "@/app/planets/globe/uniforms";
import { expect, test } from "@tests/e2e/fixtures";
import {
  brightness,
  difference,
  drawGalaxy,
  drawPlanet,
  expectLook,
  mean,
  openLab,
  planetPixels,
  type Picture,
} from "@tests/e2e/lab";

/**
 * Pixel tests of what the shaders draw, rendered in the lab page. The last
 * group compares whole pictures with the kept references in tests/e2e/looks.
 */

function appearance(overrides: Partial<AppearanceInput>): GlobeSpec {
  return planetAppearance({
    slug: "lab-b",
    source: "nasa",
    planetClass: "rocky",
    climateClass: "temperate",
    starTeffK: 5800,
    radiusEarth: 1,
    eqTempK: 290,
    densityEarth: null,
    orbitalPeriodDays: 300,
    ...overrides,
  }).globe;
}

/** Returns a solar-system planet, which uses its real texture map. */
const sol = (slug: string) => appearance({ slug, source: "sol" });

/** Returns a still rocky planet without extras, so that each test can add only the feature it checks. */
const rocky = (overrides: Partial<GlobeSpec> = {}): GlobeSpec => ({
  ...appearance({}),
  spin: 0,
  tiltDeg: 0,
  locked: 0,
  moon: null,
  aurora: null,
  ...overrides,
});

/** Returns a still gas giant without extras, for the same reason as `rocky`. */
const giant = (overrides: Partial<GlobeSpec> = {}): GlobeSpec => ({
  ...appearance({ planetClass: "gas_giant", eqTempK: 130 }),
  spin: 0,
  tiltDeg: 0,
  locked: 0,
  flattening: 0,
  rings: null,
  moon: null,
  aurora: null,
  lightning: 0,
  ...overrides,
});

/** This camera yaw looks at the night side of the planet. */
const NIGHT = Math.PI;

test.describe("shader programs", () => {
  test("every one of them compiles", async ({ page }) => {
    await openLab(page);
    // The map shaders are compiled by three.js, which prepends the version and the defines, so the test does the same.
    const forMap = (defines: string, source: string) => `#version 300 es\n${defines}${source}`;
    const programs: { name: string; vertex: string; fragment: string }[] = [
      { name: "sky", vertex: forMap("", map.SKY_VERTEX), fragment: forMap("", map.SKY_FRAGMENT) },
      { name: "galaxy", vertex: forMap("", map.SCREEN_VERTEX), fragment: forMap("", map.GALAXY_GLOW_FRAGMENT) },
      { name: "copy", vertex: forMap("", map.SCREEN_VERTEX), fragment: forMap("", map.COPY_FRAGMENT) },
      { name: "stars with planets", vertex: forMap("", map.HOSTS_VERTEX), fragment: forMap("", map.HOSTS_FRAGMENT) },
      { name: "star of a system", vertex: forMap("", map.BALL_VERTEX), fragment: forMap("", map.STAR_FRAGMENT) },
      { name: "glow of a star", vertex: forMap("", map.GLOW_VERTEX), fragment: forMap("", map.GLOW_FRAGMENT) },
      { name: "haze", vertex: forMap("", map.BALL_VERTEX), fragment: forMap("", map.HAZE_FRAGMENT) },
      { name: "moon", vertex: forMap("", map.BALL_VERTEX), fragment: forMap("", map.MOON_FRAGMENT) },
      { name: "clouds of the galaxy", vertex: forMap("", map.CLOUDS_VERTEX), fragment: forMap("", map.CLOUDS_FRAGMENT) },
      { name: "dust of the galaxy", vertex: forMap("", map.CLOUDS_VERTEX), fragment: forMap("", map.DUST_FRAGMENT) },
      { name: "stars between the stars", vertex: forMap("", map.FIELD_VERTEX), fragment: forMap("", map.FIELD_FRAGMENT) },
      { name: "landmarks", vertex: forMap("", map.LANDMARK_VERTEX), fragment: forMap("", map.LANDMARK_FRAGMENT) },
    ];
    for (const defines of ALL_SURFACE_DEFINES) {
      const lines = defineLines(defines);
      const kind = JSON.stringify(defines);
      programs.push({ name: `planet page ${kind}`, vertex: GLOBE_VERTEX, fragment: globeFragment(defines) });
      programs.push({ name: `planet on the map ${kind}`, vertex: forMap(lines, map.BALL_VERTEX), fragment: forMap(lines, map.PLANET_FRAGMENT) });
      programs.push({ name: `rings on the map ${kind}`, vertex: forMap(lines, map.RING_VERTEX), fragment: forMap(lines, map.RING_FRAGMENT) });
    }

    const failures = await page.evaluate((list) => {
      const gl = document.createElement("canvas").getContext("webgl2");
      if (!gl) return ["The browser of the test has no WebGL 2."];
      const failed: string[] = [];
      for (const { name, vertex, fragment } of list) {
        const compile = (type: number, source: string) => {
          const shader = gl.createShader(type)!;
          gl.shaderSource(shader, source);
          gl.compileShader(shader);
          return shader;
        };
        const v = compile(gl.VERTEX_SHADER, vertex);
        const f = compile(gl.FRAGMENT_SHADER, fragment);
        const program = gl.createProgram();
        gl.attachShader(program, v);
        gl.attachShader(program, f);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
          failed.push(`${name}: ${gl.getShaderInfoLog(v)} ${gl.getShaderInfoLog(f)} ${gl.getProgramInfoLog(program)}`);
        }
      }
      return failed;
    }, programs);
    expect(failures).toEqual([]);
    expect(programs.length).toBe(12 + 3 * ALL_SURFACE_DEFINES.length);
  });
});

test.describe("light and shade", () => {
  test("the side towards the star is bright, the night side dark", async ({ page }) => {
    await openLab(page);
    const mars = sol("mars");
    const pose = { seconds: 5 };
    const picture = await drawPlanet(page, mars, pose);
    const pixels = planetPixels(picture, mars, pose).filter((pixel) => pixel.fromCentre < 0.9);
    const day = mean(pixels.filter((pixel) => pixel.sunward > 0.5), (pixel) => brightness(picture, pixel.index));
    const night = mean(pixels.filter((pixel) => pixel.sunward < -0.3), (pixel) => brightness(picture, pixel.index));
    expect(day).toBeGreaterThan(70);
    expect(night).toBeLessThan(10);
    const outside = planetPixels(picture, mars, pose).filter((pixel) => pixel.fromCentre > 1.15);
    expect(Math.max(...outside.map((pixel) => picture.data[pixel.index * 4 + 3]))).toBeLessThan(40);
  });

  test("the same planet at the same moment is the same picture", async ({ page }) => {
    await openLab(page);
    const pose = { seconds: 12, flow: true };
    expect(difference(await drawPlanet(page, giant(), pose), await drawPlanet(page, giant(), pose))).toBe(0);
  });

  test("the star is reddened where it stands low, the more the thicker the air", async ({ page }) => {
    await openLab(page);
    // The planet is overcast and white all over, so any colour in the picture comes from the light.
    const overcast = (density: number) =>
      rocky({ clouds: { color: "#ffffff", cover: 1 }, atmosphere: { color: "#8ec5ff", density } });
    const pose = { seconds: 3 };
    const redness = async (spec: GlobeSpec, from: number, to: number) => {
      const picture = await drawPlanet(page, spec, pose);
      const pixels = planetPixels(picture, spec, pose).filter(
        (pixel) => pixel.fromCentre < 0.8 && pixel.sunward > from && pixel.sunward < to,
      );
      return mean(pixels, (pixel) => picture.data[pixel.index * 4]) / mean(pixels, (pixel) => picture.data[pixel.index * 4 + 2]);
    };
    const thick = overcast(1);
    const thin = overcast(0.05);
    // The range -0.1 to -0.03 is the last light before the night; 0.7 to 1 is midday.
    expect((await redness(thick, -0.1, -0.03)) / (await redness(thick, 0.7, 1))).toBeGreaterThan(1.12);
    expect((await redness(thin, -0.1, -0.03)) / (await redness(thin, 0.7, 1))).toBeLessThan(1.06);
    // The reddening must stay in a narrow seam at the terminator and not tint the day side.
    expect((await redness(thick, 0.3, 0.6)) / (await redness(thick, 0.7, 1))).toBeLessThan(1.03);
  });
});

test.describe("what moves", () => {
  test("the clouds of Earth move and change, also while the planet stands still", async ({ page }) => {
    await openLab(page);
    const earth = { ...sol("earth"), spin: 0 };
    const now = { seconds: 0 };
    const later = { seconds: 25 };
    const first = await drawPlanet(page, earth, now);
    const second = await drawPlanet(page, earth, later);
    const lit = planetPixels(first, earth, now).filter((pixel) => pixel.fromCentre < 0.9 && pixel.sunward > 0.2);
    expect(difference(first, second, lit)).toBeGreaterThan(2);
    // Mercury has no moving clouds, so a planet that stands still must not change at all.
    const mercury = { ...sol("mercury"), spin: 0 };
    expect(difference(await drawPlanet(page, mercury, now), await drawPlanet(page, mercury, later))).toBe(0);
  });

  test("the bands of a gas giant drift where that is asked for, and only there", async ({ page }) => {
    await openLab(page);
    const spec = giant();
    const drifting = difference(
      await drawPlanet(page, spec, { seconds: 1, flow: true }),
      await drawPlanet(page, spec, { seconds: 3, flow: true }),
    );
    expect(drifting).toBeGreaterThan(0.5);
    // The drift is a loop that repeats every four seconds, so 1 s and 5 s look the same.
    const loop = difference(
      await drawPlanet(page, spec, { seconds: 1, flow: true }),
      await drawPlanet(page, spec, { seconds: 5, flow: true }),
    );
    expect(loop).toBeLessThan(0.05);
    // Without `flow`, as in the list thumbnails, the bands must stand still.
    const still = difference(await drawPlanet(page, spec, { seconds: 1 }), await drawPlanet(page, spec, { seconds: 3 }));
    expect(still).toBe(0);
  });

  test("a moon circles its planet", async ({ page }) => {
    await openLab(page);
    const spec = rocky({ atmosphere: null, moon: { size: 0.16, distance: 1.5, period: 20, phase: 0.3 } });
    // The moon's position is taken as the centre of everything opaque outside the planet.
    const moonAt = async (seconds: number) => {
      const pose = { seconds };
      const picture = await drawPlanet(page, spec, pose);
      const beside = planetPixels(picture, spec, pose).filter(
        (pixel) => pixel.fromCentre > 1.12 && picture.data[pixel.index * 4 + 3] > 127,
      );
      return {
        pixels: beside.length,
        x: beside.length ? mean(beside, (pixel) => pixel.index % picture.width) : 0,
      };
    };
    // With a period of 20 s, 0 s and 10 s are half an orbit apart.
    const one = await moonAt(0);
    const other = await moonAt(10);
    expect(one.pixels).toBeGreaterThan(15);
    expect(other.pixels).toBeGreaterThan(15);
    expect(Math.abs(one.x - other.x)).toBeGreaterThan(40);
    // Without a moon the planet is drawn larger, because it no longer has to leave room for the orbit.
    const alone = rocky({ atmosphere: null });
    const picture = await drawPlanet(page, alone, { seconds: 0 });
    const beside = planetPixels(picture, alone, { seconds: 0 }).filter(
      (pixel) => pixel.fromCentre > 1.05 && picture.data[pixel.index * 4 + 3] > 127,
    );
    expect(beside).toHaveLength(0);
    expect(globeRadius(alone)).toBeGreaterThan(globeRadius(spec));
  });
});

test.describe("the night side", () => {
  test("polar lights show in the dark and not by day", async ({ page }) => {
    await openLab(page);
    const lights = rocky({ aurora: { color: "#00ff00", strength: 1 } });
    const none = rocky();
    // The aurora is pure green, so the excess of green over red and blue measures it.
    const green = (picture: Picture) => {
      let sum = 0;
      for (let at = 0; at < picture.data.length; at += 4) {
        sum += Math.max(picture.data[at + 1] - Math.max(picture.data[at], picture.data[at + 2]), 0);
      }
      return sum;
    };
    // The auroral ovals circle the poles, so the night side is viewed from above and from below as well.
    let withLights = 0;
    let without = 0;
    for (const pitch of [-1.1, 0, 1.1]) {
      const pose = { seconds: 4, yaw: NIGHT, pitch };
      withLights = Math.max(withLights, green(await drawPlanet(page, lights, pose)));
      without = Math.max(without, green(await drawPlanet(page, none, pose)));
    }
    expect(withLights).toBeGreaterThan(without + 3000);

    const pose = { seconds: 4 };
    const byDay = await drawPlanet(page, lights, pose);
    const lit = planetPixels(byDay, lights, pose).filter((pixel) => pixel.sunward > 0.15);
    expect(difference(byDay, await drawPlanet(page, none, pose), lit)).toBe(0);
  });

  test("lightning flashes in the night of a gas giant, now here, now there, and never by day", async ({ page }) => {
    await openLab(page);
    const base = giant({ glow: null });
    const stormy = { ...base, lightning: 1, bands: { ...base.bands, storms: 1 } };
    const calm = { ...base, bands: { ...base.bands, storms: 1 } };
    // Only pixels deep in the night count, so that light from the terminator is not mistaken for a flash.
    const brightest = async (spec: GlobeSpec, seconds: number) => {
      const pose = { seconds, yaw: NIGHT };
      const picture = await drawPlanet(page, spec, pose);
      const dark = planetPixels(picture, spec, pose).filter((pixel) => pixel.fromCentre < 0.9 && pixel.sunward < -0.3);
      return Math.max(...dark.map((pixel) => brightness(picture, pixel.index)));
    };
    let flashes = 0;
    const moments = 30;
    for (let moment = 0; moment < moments; moment++) {
      const seconds = moment * 0.27;
      if ((await brightest(stormy, seconds)) > 60) flashes++;
      expect(await brightest(calm, seconds)).toBeLessThan(30);
    }
    expect(flashes).toBeGreaterThan(3);
    expect(flashes).toBeLessThan(moments * 0.8);

    const pose = { seconds: 1.5 };
    const byDay = await drawPlanet(page, stormy, pose);
    const lit = planetPixels(byDay, stormy, pose).filter((pixel) => pixel.sunward > 0.15);
    expect(difference(byDay, await drawPlanet(page, calm, pose), lit)).toBe(0);
  });
});

test.describe("storms", () => {
  const CALM: GlobeSpec["storms"] = { cyclones: 0, dust: 0, spin: 0, outbreaks: 0 };
  /** These moments cover about a quarter of an hour, sampled every 3.1 seconds. */
  const MOMENTS = Array.from({ length: 300 }, (_, index) => index * 3.1);

  /**
   * Returns the middle moment of each spell in which `alive` holds. Each spell
   * places its storms elsewhere, so some of them land on the lit side facing
   * the camera.
   */
  function onePerSpell(alive: (seconds: number) => boolean): number[] {
    const picked: number[] = [];
    let spell: number[] = [];
    for (const seconds of [...MOMENTS, Infinity]) {
      if (seconds !== Infinity && alive(seconds)) {
        spell.push(seconds);
        continue;
      }
      if (spell.length) picked.push(spell[Math.floor(spell.length / 2)]);
      spell = [];
    }
    return picked;
  }

  /** Returns the largest picture difference between two planets over the given moments. */
  async function largestDifference(page: import("@playwright/test").Page, a: GlobeSpec, b: GlobeSpec, moments: number[]) {
    let largest = 0;
    for (const seconds of moments) {
      largest = Math.max(largest, difference(await drawPlanet(page, a, { seconds }), await drawPlanet(page, b, { seconds })));
    }
    return largest;
  }

  test("cyclones wind the clouds of a sea world while they live, and change nothing when none does", async ({ page }) => {
    await openLab(page);
    const stormy = rocky({ storms: { ...CALM, cyclones: 1 } });
    const calm = rocky({ storms: CALM });
    expect(stormy.clouds).not.toBeNull();
    expect(stormy.ocean).not.toBeNull();
    const strong = onePerSpell((seconds) => {
      const { uCyclones, uCycloneCount } = stormUniforms(stormy, seconds);
      return Array.from({ length: uCycloneCount }, (_, index) => uCyclones[index * 12 + 4]).some((life) => life > 0.9);
    });
    expect(strong.length).toBeGreaterThanOrEqual(3);
    expect(await largestDifference(page, stormy, calm, strong.slice(0, 8))).toBeGreaterThan(1);
    // A calmer planet has moments without any cyclone, and then it must look exactly like a calm one.
    const fewer = rocky({ storms: { ...CALM, cyclones: 0.3 } });
    const none = MOMENTS.filter((seconds) => stormUniforms(fewer, seconds).uCycloneCount === 0);
    expect(none.length).toBeGreaterThan(0);
    expect(await largestDifference(page, fewer, calm, none.slice(0, 2))).toBe(0);
  });

  test("dust storms rise over Mars and settle again", async ({ page }) => {
    await openLab(page);
    const mars = sol("mars");
    expect(mars.storms.dust).toBe(1);
    const still = { ...mars, storms: CALM };
    const dusty = onePerSpell((seconds) => Math.max(...stormUniforms(mars, seconds).uDustLives) > 0.9);
    expect(dusty.length).toBeGreaterThanOrEqual(3);
    expect(await largestDifference(page, mars, still, dusty.slice(0, 8))).toBeGreaterThan(1);
    const fewer = { ...mars, storms: { ...CALM, dust: 0.3 } };
    const clear = MOMENTS.filter((seconds) => Math.max(...stormUniforms(fewer, seconds).uDustLives) === 0);
    expect(clear.length).toBeGreaterThan(0);
    expect(await largestDifference(page, fewer, still, clear.slice(0, 2))).toBe(0);
  });

  test("a plume of fresh white cloud breaks out on a gas giant now and then", async ({ page }) => {
    await openLab(page);
    const base = giant({ glow: null, storms: { ...CALM, outbreaks: 1 } });
    const calm = { ...base, storms: CALM };
    // The plume is whiter than any zone of the planet, so counting nearly white pixels detects it.
    const white = (picture: Picture) => {
      let count = 0;
      for (let at = 0; at < picture.data.length; at += 4) {
        const [r, g, b] = [picture.data[at], picture.data[at + 1], picture.data[at + 2]];
        if (Math.min(r, g, b) > 190 && Math.max(r, g, b) - Math.min(r, g, b) < 45) count++;
      }
      return count;
    };
    const breaking = onePerSpell((seconds) => stormUniforms(base, seconds).uOutbreak[3] > 0.9);
    expect(breaking.length).toBeGreaterThanOrEqual(6);
    const more: number[] = [];
    for (const seconds of breaking.slice(0, 8)) {
      const pose = { seconds };
      more.push(white(await drawPlanet(page, base, pose)) - white(await drawPlanet(page, calm, pose)));
    }
    expect(Math.max(...more), `more white pixels at ${breaking.slice(0, 8).join(", ")} s: ${more.join(", ")}`).toBeGreaterThan(20);
    const fewer = { ...base, storms: { ...CALM, outbreaks: 0.4 } };
    const quiet = MOMENTS.filter((seconds) => stormUniforms(fewer, seconds).uOutbreak[3] === 0);
    expect(await largestDifference(page, fewer, calm, quiet.slice(0, 2))).toBe(0);
  });

  test("the storms of a gas giant turn where its bands drift, and stand still where they do not", async ({ page }) => {
    await openLab(page);
    // The planet turns once in 40 seconds, so each side comes into view over the four moments.
    const turning = giant({ spin: 1, storms: { ...CALM, spin: 1 } });
    expect(turning.giantStorms.length).toBeGreaterThan(0);
    const still = { ...turning, storms: CALM };
    // A turning storm differs only slightly and only inside the storm, so the test
    // counts changed pixels, because the mean difference would be too small to see.
    const changed = (a: Picture, b: Picture) => {
      let count = 0;
      for (let at = 0; at < a.data.length; at += 4) {
        if ([0, 1, 2].some((channel) => Math.abs(a.data[at + channel] - b.data[at + channel]) > 1)) count++;
      }
      return count;
    };
    let most = 0;
    for (const seconds of [3, 13, 23, 33]) {
      const pose = { seconds, flow: true };
      most = Math.max(most, changed(await drawPlanet(page, turning, pose, 320), await drawPlanet(page, still, pose, 320)));
      expect(difference(await drawPlanet(page, turning, { seconds }), await drawPlanet(page, still, { seconds }))).toBe(0);
    }
    expect(most).toBeGreaterThan(100);
  });
});

test.describe("small planets", () => {
  /**
   * Returns the mean difference between a planet drawn small and the same
   * planet drawn four times larger and downscaled, which is what an ideal
   * camera would see. Grain finer than a pixel shows up as a large value.
   */
  async function grain(page: import("@playwright/test").Page, spec: GlobeSpec, size: number) {
    const pose = { seconds: 30, flow: true };
    const small = await drawPlanet(page, spec, pose, size);
    const large = await drawPlanet(page, spec, pose, size * 4);
    const clean = await sharp(Buffer.from(large.data), { raw: { width: size * 4, height: size * 4, channels: 4 } })
      .resize(size, size, { kernel: "cubic" })
      .raw()
      .toBuffer();
    let sum = 0;
    let count = 0;
    for (let at = 0; at < small.data.length; at += 4) {
      // Only pixels fully covered by the planet count, because its edge is smoothed anyway.
      if (clean[at + 3] < 250 || small.data[at + 3] < 250) continue;
      sum += (Math.abs(small.data[at] - clean[at]) + Math.abs(small.data[at + 1] - clean[at + 1]) + Math.abs(small.data[at + 2] - clean[at + 2])) / 3;
      count++;
    }
    return sum / count;
  }

  test("show no grain finer than their pixels", async ({ page }) => {
    await openLab(page);
    const dry = appearance({ slug: "k2-3-c", planetClass: "super_earth", climateClass: "hot", eqTempK: 372, orbitalPeriodDays: 24.6, starTeffK: 3844 });
    const sea = appearance({ slug: "k2-3-d", planetClass: "super_earth", climateClass: "temperate", eqTempK: 305, orbitalPeriodDays: 44.6, starTeffK: 3844 });
    // Drawing every noise octave at every size gave 2.9 for the dry world, so 2.2 catches a relapse.
    expect(await grain(page, dry, 180)).toBeLessThan(2.2);
    expect(await grain(page, sea, 180)).toBeLessThan(3);
  });

  test("show no blocks of two by two pixels in their clouds", async ({ page }) => {
    await openLab(page);
    // Cloud shading uses screen-space derivatives, which the GPU computes per
    // block of 2x2 pixels. When that becomes visible, the steps between blocks
    // are larger than the steps inside them.
    const sea = appearance({ slug: "k2-3-d", planetClass: "super_earth", climateClass: "temperate", eqTempK: 305, orbitalPeriodDays: 44.6, starTeffK: 3844 });
    const pose = { seconds: 30, flow: true };
    const size = 180;
    const picture = await drawPlanet(page, sea, pose, size);
    let inside = 0;
    let between = 0;
    for (const pixel of planetPixels(picture, sea, pose)) {
      const x = pixel.index % size;
      if (pixel.fromCentre > 0.85 || pixel.sunward < 0.1 || x >= size - 1) continue;
      // Only bright pixels are clouds; the darker ground would dilute the measure.
      const here = brightness(picture, pixel.index);
      if (here < 150) continue;
      const step = Math.abs(brightness(picture, pixel.index + 1) - here);
      // WebGL and the picture both count columns from the left, so each block starts at an even column.
      if (x % 2 === 0) inside += step;
      else between += step;
    }
    // A ratio of 1 means no visible blocks. Derivative-based shading everywhere gave 1.34.
    expect(between / inside).toBeLessThan(1.22);
  });
});

test.describe("shape", () => {
  /** Returns the width and height of everything opaque in the picture, in pixels. */
  function extent(picture: Picture): { width: number; height: number } {
    let left = picture.width;
    let right = -1;
    let top = picture.height;
    let bottom = -1;
    for (let y = 0; y < picture.height; y++) {
      for (let x = 0; x < picture.width; x++) {
        if (picture.data[(y * picture.width + x) * 4 + 3] < 128) continue;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
    return { width: right - left + 1, height: bottom - top + 1 };
  }

  test("a giant that turns fast is flattened at its poles", async ({ page }) => {
    await openLab(page);
    const round = extent(await drawPlanet(page, giant({ atmosphere: null }), { seconds: 0 }, 240));
    expect(round.height / round.width).toBeCloseTo(1, 1);
    const flat = extent(await drawPlanet(page, giant({ atmosphere: null, flattening: 0.1 }), { seconds: 0 }, 240));
    // The axis leans 0.24 radians towards the viewer, which hides some of the flattening.
    const lean = 0.24;
    const expected = Math.sqrt((0.9 * Math.cos(lean)) ** 2 + Math.sin(lean) ** 2);
    expect(flat.height / flat.width).toBeGreaterThan(expected - 0.015);
    expect(flat.height / flat.width).toBeLessThan(expected + 0.015);
    expect(flat.width).toBe(round.width);
  });

  test("rings reach far beyond the planet", async ({ page }) => {
    await openLab(page);
    const saturn = sol("saturn");
    const pose = { seconds: 0 };
    const picture = await drawPlanet(page, saturn, pose, 240);
    const pixels = planetPixels(picture, saturn, pose);
    const rings = pixels.filter(
      (pixel) => pixel.fromCentre > 1.3 && pixel.fromCentre < 2.2 && picture.data[pixel.index * 4 + 3] > 60,
    );
    expect(rings.length).toBeGreaterThan(600);
    const beyond = pixels.filter((pixel) => pixel.fromCentre > 2.4 && picture.data[pixel.index * 4 + 3] > 60);
    expect(beyond).toHaveLength(0);
  });

  test("a planet held by its star has another climate than one with days and nights", async ({ page }) => {
    await openLab(page);
    const pose = { seconds: 2 };
    const free = await drawPlanet(page, rocky(), pose);
    const held = await drawPlanet(page, rocky({ locked: 1, zones: 1 }), pose);
    expect(difference(free, held)).toBeGreaterThan(1);
  });
});

test.describe("the galaxy", () => {
  const FAR = 60_000;

  test("looks like the artist's impression from straight above", async ({ page }) => {
    await openLab(page);
    const size = 96;
    // The camera is far enough up that the galaxy just fills the view, with the centre at the top.
    const drawn = await drawGalaxy(
      page,
      { eye: [0, 0, FAR], forward: [0, 0, -1], up: [1, 0, 0], reach: GALAXY_PICTURE_WIDTH / 2 / FAR },
      size,
    );
    const original = await sharp(path.resolve("public/textures/sky/galaxy.jpg"))
      .resize(size, size)
      .greyscale()
      .raw()
      .toBuffer();
    // This is the Pearson correlation of brightness: 1 for the same picture and 0 for no likeness.
    const a = Array.from({ length: size * size }, (_, index) => brightness(drawn, index));
    const b = Array.from(original);
    const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    const [meanA, meanB] = [average(a), average(b)];
    let both = 0;
    let onlyA = 0;
    let onlyB = 0;
    for (let i = 0; i < a.length; i++) {
      both += (a[i] - meanA) * (b[i] - meanB);
      onlyA += (a[i] - meanA) ** 2;
      onlyB += (b[i] - meanB) ** 2;
    }
    expect(both / Math.sqrt(onlyA * onlyB)).toBeGreaterThan(0.93);
  });

  test("is a thin streak with a bulge from the side", async ({ page }) => {
    await openLab(page);
    const size = 200;
    const drawn = await drawGalaxy(page, { eye: [-FAR, 0, 0], forward: [1, 0, 0], up: [0, 0, 1], reach: 0.4 }, size);
    const rows = Array.from({ length: size }, (_, y) => {
      let sum = 0;
      for (let x = 0; x < size; x++) sum += brightness(drawn, y * size + x);
      return sum;
    });
    const all = rows.reduce((sum, row) => sum + row, 0);
    expect(all).toBeGreaterThan(0);
    // A thin disc puts nearly all its light into a band a seventh of the picture high.
    const band = rows.slice(size * 0.43, size * 0.57).reduce((sum, row) => sum + row, 0);
    expect(band / all).toBeGreaterThan(0.8);
    // The central bulge puts more light above the plane in the middle than further out.
    const above = (x: number) => brightness(drawn, Math.round(size * 0.48) * size + x);
    expect(above(size / 2)).toBeGreaterThan(above(Math.round(size * 0.25)) + 40);
  });

  test("leaves the sky black where it is not", async ({ page }) => {
    await openLab(page);
    // The camera is above the disc and looks away from it.
    const away = await drawGalaxy(page, { eye: [0, 0, FAR], forward: [0, 0, 1], up: [1, 0, 0] });
    expect(Math.max(...away.data.filter((_, at) => at % 4 !== 3))).toBeLessThanOrEqual(2);
  });

  test("is the band of the Milky Way from inside, with a dark sky above", async ({ page }) => {
    await openLab(page);
    // The camera is near the Sun, about 8,200 parsecs from the centre and slightly above the plane.
    const eye: [number, number, number] = [-8500, 250, 30];
    const average = (picture: Picture, from: number, to: number) => {
      let sum = 0;
      for (let index = from * picture.width; index < to * picture.width; index++) sum += brightness(picture, index);
      return sum / ((to - from) * picture.width);
    };
    const up = await drawGalaxy(page, { eye, forward: [0, 0, 1], up: [1, 0, 0], outside: 0 });
    expect(average(up, 0, up.height)).toBeLessThan(45);
    const along = await drawGalaxy(page, { eye, forward: [1, 0, 0], up: [0, 0, 1], outside: 0 });
    const band = average(along, along.height * 0.44, along.height * 0.56);
    const sky = average(along, 0, along.height * 0.2);
    expect(band).toBeGreaterThan(sky * 1.5);
  });
});

test.describe("the look", () => {
  /** These are the planets of the test catalogue, built as the app builds them. */
  const planets: [name: string, spec: () => GlobeSpec][] = [
    ["earth", () => sol("earth")],
    ["mars", () => sol("mars")],
    ["venus", () => sol("venus")],
    ["jupiter", () => sol("jupiter")],
    ["saturn", () => sol("saturn")],
    ["neptune", () => sol("neptune")],
    ["mild-world", () => appearance({ slug: "trappist-1-e", eqTempK: 250, orbitalPeriodDays: 6.1, starTeffK: 2566 })],
    ["cold-world", () => appearance({ slug: "proxima-cen-b", climateClass: "cold", eqTempK: 234, orbitalPeriodDays: 11.2, starTeffK: 3050 })],
    ["frozen-world", () => appearance({ slug: "lab-ice-b", climateClass: "frozen", eqTempK: 70 })],
    ["hot-world", () => appearance({ slug: "kepler-220-b", climateClass: "hot", eqTempK: 860, orbitalPeriodDays: 4.2 })],
    ["lava-world", () => appearance({ slug: "55-cnc-e", planetClass: "super_earth", climateClass: "scorching", eqTempK: 1958, orbitalPeriodDays: 0.74 })],
    ["cold-giant", () => appearance({ slug: "lab-giant-b", planetClass: "gas_giant", climateClass: "frozen", eqTempK: 110 })],
    ["hot-giant", () => appearance({ slug: "51-peg-b", planetClass: "gas_giant", climateClass: "scorching", eqTempK: 1260, orbitalPeriodDays: 4.2 })],
    ["mild-neptune", () => appearance({ slug: "k2-18-b", planetClass: "neptune_like", eqTempK: 255, orbitalPeriodDays: 33 })],
  ];

  for (const [name, spec] of planets) {
    test(`${name} looks as it did`, async ({ page }) => {
      await openLab(page);
      await expectLook(await drawPlanet(page, spec(), { seconds: 7, flow: true }, 192), name);
    });
  }

  test("the galaxy looks as it did, from above and from the side", async ({ page }) => {
    await openLab(page);
    await expectLook(
      await drawGalaxy(page, { eye: [-15_000, -13_000, 21_000], forward: [0.52, 0.45, -0.73], up: [0.55, 0.48, 0.68] }, 192),
      "galaxy-from-above",
    );
    await expectLook(
      await drawGalaxy(page, { eye: [-60_000, 0, 2_000], forward: [1, 0, 0], up: [0, 0, 1], reach: 0.4 }, 192),
      "galaxy-from-the-side",
    );
  });
});
