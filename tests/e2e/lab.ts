import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import sharp from "sharp";
import { GALACTIC_CENTRE } from "@/app/map/galaxy";
import { GALAXY_GLOW_FRAGMENT, SCREEN_VERTEX } from "@/app/map/scene/shaders";
import { globeFragment, GLOBE_VERTEX } from "@/app/planets/globe/globe.glsl";
import { NOISE_SIZE, noiseVolume } from "@/app/planets/globe/noise";
import { poseUniforms, type GlobePose } from "@/app/planets/globe/renderer";
import { globeRadius, lightDirection, lockedSway, type GlobeSpec } from "@/app/planets/globe/spec";
import { surfaceDefines, surfaceUniforms, textureUrls } from "@/app/planets/globe/uniforms";

/**
 * A laboratory for the shaders: draws a planet or the galaxy in the browser
 * of a test, with the real shader code and the real maps, and hands the
 * pixels to the test.
 *
 * The 3D model of the planet pages (PlanetViewer) can only be steered through
 * its buttons, and the map only by flying. Here a test chooses the planet,
 * the moment and the point of view itself, so it can look at one thing at a
 * time: the night side, the same planet a few seconds later, the galaxy from
 * the side. What is drawn is put together exactly as renderer.ts does it
 * (surfaceUniforms, poseUniforms, textureUrls).
 */

/** A picture as red, green, blue and opacity per pixel, 0 to 255, rows from the top. */
export interface Picture {
  width: number;
  height: number;
  data: Uint8Array;
}

interface Job {
  vertex: string;
  fragment: string;
  /** One triangle over everything without any buffer, or a square with positions and picture coordinates. */
  shape: "triangle" | "square";
  uniforms: Record<string, number | number[]>;
  /** The pictures the shader reads, in the order of its texture units. `null` is an empty one. */
  maps: { name: string; url: string | null; wraps: boolean }[];
  /** Whether the shader reads the noise of the planets, and from which texture unit. */
  noise: boolean;
  width: number;
  height: number;
}

/** Runs in the page: sets up WebGL once and then draws job after job. */
async function drawInPage({ job, noise, noiseSize }: { job: Job; noise: string | null; noiseSize: number }) {
  interface Lab {
    canvas: HTMLCanvasElement;
    gl: WebGL2RenderingContext;
    programs: Map<string, WebGLProgram>;
    maps: Map<string, WebGLTexture>;
    blank: WebGLTexture;
    noise: WebGLTexture | null;
    square: WebGLBuffer;
  }
  const scope = window as unknown as { shaderLab?: Lab };
  if (!scope.shaderLab) {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2", { alpha: true, antialias: false, preserveDrawingBuffer: true });
    if (!context) throw new Error("The browser of the test has no WebGL 2.");
    const blank = context.createTexture();
    context.bindTexture(context.TEXTURE_2D, blank);
    context.texImage2D(context.TEXTURE_2D, 0, context.RGBA, 1, 1, 0, context.RGBA, context.UNSIGNED_BYTE, new Uint8Array(4));
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.NEAREST);
    const square = context.createBuffer();
    context.bindBuffer(context.ARRAY_BUFFER, square);
    context.bufferData(
      context.ARRAY_BUFFER,
      new Float32Array([-1, -1, 0, 0, 0, 1, -1, 0, 1, 0, -1, 1, 0, 0, 1, 1, 1, 0, 1, 1]),
      context.STATIC_DRAW,
    );
    context.disable(context.DEPTH_TEST);
    context.disable(context.BLEND);
    scope.shaderLab = { canvas, gl: context, programs: new Map(), maps: new Map(), blank, noise: null, square };
  }
  const lab = scope.shaderLab;
  const gl = lab.gl;

  if (noise && !lab.noise) {
    const bytes = Uint8Array.from(atob(noise), (character) => character.charCodeAt(0));
    lab.noise = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, lab.noise);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R16F, noiseSize, noiseSize, noiseSize, 0, gl.RED, gl.FLOAT, new Float32Array(bytes.buffer));
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.REPEAT);
  }

  const key = job.vertex + job.fragment;
  let program = lab.programs.get(key);
  if (!program) {
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "The shader does not compile.");
      return shader;
    };
    program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, job.vertex));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, job.fragment));
    gl.bindAttribLocation(program, 0, "position");
    gl.bindAttribLocation(program, 1, "uv");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "The program does not link.");
    lab.programs.set(key, program);
  }
  gl.useProgram(program);

  for (const { url, wraps } of job.maps) {
    if (!url || lab.maps.has(url)) continue;
    const image = new Image();
    image.src = url;
    await image.decode();
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wraps ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    lab.maps.set(url, texture);
  }

  for (const [name, value] of Object.entries(job.uniforms)) {
    const location = gl.getUniformLocation(program, name);
    if (typeof value === "number") gl.uniform1f(location, value);
    else if (value.length === 2) gl.uniform2fv(location, value);
    else if (value.length === 3) gl.uniform3fv(location, value);
    else if (value.length === 4) gl.uniform4fv(location, value);
    else gl.uniformMatrix3fv(location, false, value);
  }
  job.maps.forEach(({ name, url }, unit) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, url ? lab.maps.get(url)! : lab.blank);
    gl.uniform1i(gl.getUniformLocation(program, name), unit);
  });
  if (job.noise) {
    gl.activeTexture(gl.TEXTURE0 + job.maps.length);
    gl.bindTexture(gl.TEXTURE_3D, lab.noise);
    gl.uniform1i(gl.getUniformLocation(program, "uNoise"), job.maps.length);
  }

  lab.canvas.width = job.width;
  lab.canvas.height = job.height;
  gl.viewport(0, 0, job.width, job.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  if (job.shape === "square") {
    gl.bindBuffer(gl.ARRAY_BUFFER, lab.square);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  } else {
    gl.disableVertexAttribArray(0);
    gl.disableVertexAttribArray(1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  const pixels = new Uint8Array(job.width * job.height * 4);
  gl.readPixels(0, 0, job.width, job.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  let text = "";
  for (let at = 0; at < pixels.length; at += 32768) {
    text += String.fromCharCode(...pixels.subarray(at, at + 32768));
  }
  return btoa(text);
}

let noiseAsText: string | undefined;

async function draw(page: Page, job: Job): Promise<Picture> {
  // The noise is computed here, as the app computes it in the browser, and sent along once.
  if (job.noise) noiseAsText ??= Buffer.from(noiseVolume().buffer).toString("base64");
  const text = await page.evaluate(drawInPage, {
    job,
    noise: job.noise ? (noiseAsText ?? null) : null,
    noiseSize: NOISE_SIZE,
  });
  const upsideDown = Buffer.from(text, "base64");
  // WebGL counts rows from the bottom.
  const data = new Uint8Array(upsideDown.length);
  const row = job.width * 4;
  for (let y = 0; y < job.height; y++) {
    data.set(upsideDown.subarray((job.height - 1 - y) * row, (job.height - y) * row), y * row);
  }
  return { width: job.width, height: job.height, data };
}

/** Opens a page of the site, so the maps can be fetched from it. Call once per test. */
export async function openLab(page: Page): Promise<void> {
  await page.goto("/legal/notice");
}

/** A planet as renderer.ts draws it, in a square of `size` pixels. */
export function drawPlanet(page: Page, spec: GlobeSpec, pose: GlobePose, size = 160): Promise<Picture> {
  const urls = textureUrls(spec, "sm");
  return draw(page, {
    vertex: GLOBE_VERTEX,
    fragment: globeFragment(surfaceDefines(spec)),
    shape: "triangle",
    uniforms: {
      ...surfaceUniforms(spec),
      ...poseUniforms(spec, pose, { x: 0, y: 0, width: size, height: size }),
    },
    maps: [
      { name: "uMapDay", url: urls.day, wraps: true },
      { name: "uMapNight", url: urls.night, wraps: true },
      { name: "uMapClouds", url: urls.clouds, wraps: true },
      { name: "uRingMap", url: urls.ring, wraps: false },
    ],
    noise: true,
    width: size,
    height: size,
  });
}

/** From where the galaxy is looked at: the place of the camera, counted from the galactic centre, and its directions. */
export interface GalaxyView {
  /** Parsecs from the galactic centre. */
  eye: [number, number, number];
  forward: [number, number, number];
  /** The direction that is up in the picture. Has to stand at right angles to `forward`. */
  up: [number, number, number];
  /** Half the height of the picture at the distance 1: 0.52 is the field of view of the map. */
  reach?: number;
  /** 1 for a camera outside the disc, 0 for one inside (see GalaxyView.update). */
  outside?: number;
}

/** The galaxy as the map draws it, in a square of `size` pixels. */
export function drawGalaxy(page: Page, view: GalaxyView, size = 160): Promise<Picture> {
  const reach = view.reach ?? 0.52;
  const [fx, fy, fz] = view.forward;
  const [ux, uy, uz] = view.up;
  const right = [fy * uz - fz * uy, fz * ux - fx * uz, fx * uy - fy * ux];
  return draw(page, {
    vertex: `#version 300 es\n${SCREEN_VERTEX}`,
    fragment: `#version 300 es\n${GALAXY_GLOW_FRAGMENT}`,
    shape: "square",
    uniforms: {
      uEye: view.eye.map((value, axis) => value + GALACTIC_CENTRE[axis]),
      uForward: view.forward,
      uRight: right.map((value) => value * reach),
      uUp: view.up.map((value) => value * reach),
      uFade: 1,
      uOutside: view.outside ?? 1,
    },
    maps: [{ name: "uMap", url: "/textures/sky/galaxy-sm.jpg", wraps: false }],
    noise: false,
    width: size,
    height: size,
  });
}

// ---- Looking at a picture -----------------------------------------------------

/** Brightness of the pixel at `index`, 0 to 255. */
export function brightness(picture: Picture, index: number): number {
  const at = index * 4;
  return 0.3 * picture.data[at] + 0.6 * picture.data[at + 1] + 0.1 * picture.data[at + 2];
}

/** A pixel of a planet picture, with what a test wants to know about its place. */
export interface PlanetPixel {
  index: number;
  /** Distance from the centre of the planet in planet radii: below 1 on the planet. */
  fromCentre: number;
  /** How directly the star shines on the place: 1 with the star overhead, 0 at the edge of the night, negative on the night side. */
  sunward: number;
}

/**
 * The pixels of a planet picture drawn by `drawPlanet` with the same planet
 * and pose, with the place of each on the ball. Flattened planets count as balls.
 */
export function planetPixels(picture: Picture, spec: GlobeSpec, pose: GlobePose): PlanetPixel[] {
  const size = picture.width;
  const radius = (size / 2) * globeRadius(spec) * (pose.zoom ?? 1);
  const light = lightDirection((pose.yaw ?? 0) + lockedSway(spec, pose.seconds), pose.pitch);
  const pixels: PlanetPixel[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - size / 2) / radius;
      const dy = (size / 2 - (y + 0.5)) / radius;
      const fromCentre = Math.hypot(dx, dy);
      const dz = Math.sqrt(Math.max(1 - fromCentre * fromCentre, 0));
      pixels.push({
        index: y * size + x,
        fromCentre,
        sunward: fromCentre < 1 ? dx * light[0] + dy * light[1] + dz * light[2] : 0,
      });
    }
  }
  return pixels;
}

/** The mean of `value` over the pixels. */
export function mean(pixels: readonly PlanetPixel[], value: (pixel: PlanetPixel) => number): number {
  if (pixels.length === 0) throw new Error("No pixel to look at.");
  return pixels.reduce((sum, pixel) => sum + value(pixel), 0) / pixels.length;
}

/** How much two pictures differ: the mean difference per colour value, 0 to 255. */
export function difference(a: Picture, b: Picture, among?: readonly PlanetPixel[]): number {
  const indices = among ? among.map((pixel) => pixel.index) : Array.from({ length: a.width * a.height }, (_, i) => i);
  let sum = 0;
  for (const index of indices) {
    for (let channel = 0; channel < 3; channel++) {
      sum += Math.abs(a.data[index * 4 + channel] - b.data[index * 4 + channel]);
    }
  }
  return sum / (indices.length * 3);
}

// ---- The look, kept as small pictures -----------------------------------------

const LOOKS = path.resolve("tests/e2e/looks");
/** The small pictures have this many pixels along each side. */
const LOOK_SIZE = 48;
/** How far a picture may be from its kept one, as the mean difference per colour value of 255. */
const LOOK_TOLERANCE = 5;

/**
 * Compares a picture with the one kept under `name` in tests/e2e/looks.
 *
 * Both are shrunk to a few dozen pixels first: that is blind to a pixel more
 * or less at an edge, which differs between machines, and sees what counts,
 * a planet that has changed its colours, lost its clouds or turned black.
 *
 * After a change to the look that is meant, the kept pictures are renewed
 * with `UPDATE_LOOKS=1 npm run test:e2e -- shaders`, and the new ones are
 * looked over before they are checked in.
 */
export async function expectLook(picture: Picture, name: string): Promise<void> {
  const file = path.join(LOOKS, `${name}.png`);
  // The colours of a planet picture are already multiplied by its opacity: on black, that is the picture.
  const small = sharp(Buffer.from(picture.data), { raw: { width: picture.width, height: picture.height, channels: 4 } })
    .removeAlpha()
    .resize(LOOK_SIZE, LOOK_SIZE, { kernel: "cubic" });
  if (process.env.UPDATE_LOOKS) {
    mkdirSync(LOOKS, { recursive: true });
    await small.png().toFile(file);
    return;
  }
  expect(existsSync(file), `There is no kept picture ${name}.png yet. Run with UPDATE_LOOKS=1 to make it.`).toBe(true);
  const now = await small.raw().toBuffer();
  const kept = await sharp(readFileSync(file)).removeAlpha().raw().toBuffer();
  let sum = 0;
  for (let i = 0; i < now.length; i++) sum += Math.abs(now[i] - kept[i]);
  expect(sum / now.length, `The look of ${name} has changed. If that is meant, renew tests/e2e/looks with UPDATE_LOOKS=1.`).toBeLessThan(LOOK_TOLERANCE);
}
