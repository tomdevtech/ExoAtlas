/**
 * The noise the planet shaders build their surfaces from, computed ahead of
 * time into a 3D texture.
 *
 * Calculating the noise inside the shader made the shader so large that
 * Direct3D (WebGL on Windows) took around five seconds to compile it. Reading
 * it from a texture compiles about ten times faster and also draws faster.
 *
 * Each texel holds gradient noise (roughly -0.7 to 0.7) and its slope along
 * x, y and z. The slope is exact, not taken from neighbouring texels, so
 * light on mountains stays smooth although the texture is only interpolated
 * linearly between texels.
 */

/** Lattice cells along each axis before the pattern repeats. */
export const NOISE_PERIOD = 8;
/** Texels per lattice cell along each axis. */
const STEPS = 8;
/** Texels along each axis of the texture. */
export const NOISE_SIZE = NOISE_PERIOD * STEPS;

let volume: Float32Array | undefined;

/**
 * The texture data: four numbers per texel (noise, slope x, slope y, slope z),
 * x running fastest. Computed on first use, then shared.
 */
export function noiseVolume(): Float32Array {
  volume ??= computeVolume();
  return volume;
}

/** GLSL that reads the texture. Needs `uniform highp sampler3D uNoise`. */
export const NOISE_GLSL = /* glsl */ `
// Gradient noise, roughly -0.7 to 0.7, in x and its slope in yzw. Read from a
// texture computed in noise.ts; the pattern repeats every ${NOISE_PERIOD} units.
vec4 noiseD(vec3 x) {
  return textureLod(uNoise, fract(x * ${(1 / NOISE_PERIOD).toFixed(6)}) + ${(0.5 / NOISE_SIZE).toFixed(6)}, 0.0);
}

float gnoise(vec3 x) {
  return noiseD(x).x;
}
`;

/** The same integer hash (PCG) the shaders use, in 32-bit unsigned arithmetic. */
export function pcg3d(x: number, y: number, z: number): [number, number, number] {
  x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
  y = (Math.imul(y, 1664525) + 1013904223) >>> 0;
  z = (Math.imul(z, 1664525) + 1013904223) >>> 0;
  x = (x + Math.imul(y, z)) >>> 0;
  y = (y + Math.imul(z, x)) >>> 0;
  z = (z + Math.imul(x, y)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  y = (y ^ (y >>> 16)) >>> 0;
  z = (z ^ (z >>> 16)) >>> 0;
  x = (x + Math.imul(y, z)) >>> 0;
  y = (y + Math.imul(z, x)) >>> 0;
  z = (z + Math.imul(x, y)) >>> 0;
  return [x, y, z];
}

/** Random gradients at the lattice points, each component from -1 to 1. */
function latticeGradients(): Float64Array {
  const gradients = new Float64Array(NOISE_PERIOD ** 3 * 3);
  for (let k = 0; k < NOISE_PERIOD; k++) {
    for (let j = 0; j < NOISE_PERIOD; j++) {
      for (let i = 0; i < NOISE_PERIOD; i++) {
        const hash = pcg3d(i + 65536, j + 65536, k + 65536);
        const at = ((k * NOISE_PERIOD + j) * NOISE_PERIOD + i) * 3;
        for (let c = 0; c < 3; c++) gradients[at + c] = (hash[c] / 4294967295) * 2 - 1;
      }
    }
  }
  return gradients;
}

/**
 * Gradient noise and its slope at a point, with the lattice repeating every
 * NOISE_PERIOD units. Follows https://iquilezles.org/articles/gradientnoise/.
 */
export function noiseAt(
  x: number,
  y: number,
  z: number,
  gradients: Float64Array = sharedGradients(),
): [number, number, number, number] {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const wrap = (n: number) => ((n % NOISE_PERIOD) + NOISE_PERIOD) % NOISE_PERIOD;
  const corner = (dx: number, dy: number, dz: number) => {
    const at =
      ((wrap(iz + dz) * NOISE_PERIOD + wrap(iy + dy)) * NOISE_PERIOD + wrap(ix + dx)) * 3;
    const gx = gradients[at];
    const gy = gradients[at + 1];
    const gz = gradients[at + 2];
    return { gx, gy, gz, v: gx * (fx - dx) + gy * (fy - dy) + gz * (fz - dz) };
  };
  const a = corner(0, 0, 0);
  const b = corner(1, 0, 0);
  const c = corner(0, 1, 0);
  const d = corner(1, 1, 0);
  const e = corner(0, 0, 1);
  const f = corner(1, 0, 1);
  const g = corner(0, 1, 1);
  const h = corner(1, 1, 1);

  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const fadeSlope = (t: number) => 30 * t * t * (t * (t - 2) + 1);
  const ux = fade(fx);
  const uy = fade(fy);
  const uz = fade(fz);
  const dux = fadeSlope(fx);
  const duy = fadeSlope(fy);
  const duz = fadeSlope(fz);

  const k0 = a.v;
  const k1 = b.v - a.v;
  const k2 = c.v - a.v;
  const k3 = e.v - a.v;
  const k4 = a.v - b.v - c.v + d.v;
  const k5 = a.v - c.v - e.v + g.v;
  const k6 = a.v - b.v - e.v + f.v;
  const k7 = -a.v + b.v + c.v - d.v + e.v - f.v - g.v + h.v;
  const value =
    k0 + k1 * ux + k2 * uy + k3 * uz + k4 * ux * uy + k5 * uy * uz + k6 * uz * ux + k7 * ux * uy * uz;

  // The slope: the gradients blended like the values, plus the change of the blend itself.
  const blend = (pick: (corner: { gx: number; gy: number; gz: number }) => number) =>
    pick(a) +
    ux * (pick(b) - pick(a)) +
    uy * (pick(c) - pick(a)) +
    uz * (pick(e) - pick(a)) +
    ux * uy * (pick(a) - pick(b) - pick(c) + pick(d)) +
    uy * uz * (pick(a) - pick(c) - pick(e) + pick(g)) +
    uz * ux * (pick(a) - pick(b) - pick(e) + pick(f)) +
    ux * uy * uz * (-pick(a) + pick(b) + pick(c) - pick(d) + pick(e) - pick(f) - pick(g) + pick(h));
  const slopeX = blend((q) => q.gx) + dux * (k1 + k4 * uy + k6 * uz + k7 * uy * uz);
  const slopeY = blend((q) => q.gy) + duy * (k2 + k5 * uz + k4 * ux + k7 * uz * ux);
  const slopeZ = blend((q) => q.gz) + duz * (k3 + k6 * ux + k5 * uy + k7 * ux * uy);
  return [value, slopeX, slopeY, slopeZ];
}

let gradientsCache: Float64Array | undefined;

function sharedGradients(): Float64Array {
  gradientsCache ??= latticeGradients();
  return gradientsCache;
}

/**
 * The same as calling noiseAt for every texel, written for speed: it runs in
 * the browser before the first planet can be drawn. The noise is the sum over
 * the eight corners of a cell of weight × (gradient · offset); the slope
 * follows from the product rule.
 */
function computeVolume(): Float32Array {
  const gradients = sharedGradients();
  const data = new Float32Array(NOISE_SIZE ** 3 * 4);
  // Blend weights towards the far corner and their slopes, per position in the cell.
  const fade = new Float64Array(STEPS);
  const fadeSlope = new Float64Array(STEPS);
  for (let s = 0; s < STEPS; s++) {
    const t = s / STEPS;
    fade[s] = t * t * t * (t * (t * 6 - 15) + 10);
    fadeSlope[s] = 30 * t * t * (t * (t - 2) + 1);
  }
  const corners = new Float64Array(8 * 3);
  for (let cz = 0; cz < NOISE_PERIOD; cz++) {
    for (let cy = 0; cy < NOISE_PERIOD; cy++) {
      for (let cx = 0; cx < NOISE_PERIOD; cx++) {
        for (let n = 0; n < 8; n++) {
          const gx = (cx + (n & 1)) % NOISE_PERIOD;
          const gy = (cy + ((n >> 1) & 1)) % NOISE_PERIOD;
          const gz = (cz + ((n >> 2) & 1)) % NOISE_PERIOD;
          const from = ((gz * NOISE_PERIOD + gy) * NOISE_PERIOD + gx) * 3;
          corners[n * 3] = gradients[from];
          corners[n * 3 + 1] = gradients[from + 1];
          corners[n * 3 + 2] = gradients[from + 2];
        }
        for (let sz = 0; sz < STEPS; sz++) {
          const fz = sz / STEPS;
          for (let sy = 0; sy < STEPS; sy++) {
            const fy = sy / STEPS;
            let at =
              (((cz * STEPS + sz) * NOISE_SIZE + cy * STEPS + sy) * NOISE_SIZE + cx * STEPS) * 4;
            for (let sx = 0; sx < STEPS; sx++) {
              const fx = sx / STEPS;
              let value = 0;
              let slopeX = 0;
              let slopeY = 0;
              let slopeZ = 0;
              for (let n = 0; n < 8; n++) {
                const ox = n & 1;
                const oy = (n >> 1) & 1;
                const oz = (n >> 2) & 1;
                const gx = corners[n * 3];
                const gy = corners[n * 3 + 1];
                const gz = corners[n * 3 + 2];
                const dot = gx * (fx - ox) + gy * (fy - oy) + gz * (fz - oz);
                const wx = ox ? fade[sx] : 1 - fade[sx];
                const wy = oy ? fade[sy] : 1 - fade[sy];
                const wz = oz ? fade[sz] : 1 - fade[sz];
                const dwx = ox ? fadeSlope[sx] : -fadeSlope[sx];
                const dwy = oy ? fadeSlope[sy] : -fadeSlope[sy];
                const dwz = oz ? fadeSlope[sz] : -fadeSlope[sz];
                const weight = wx * wy * wz;
                value += weight * dot;
                slopeX += weight * gx + dwx * wy * wz * dot;
                slopeY += weight * gy + wx * dwy * wz * dot;
                slopeZ += weight * gz + wx * wy * dwz * dot;
              }
              data[at] = value;
              data[at + 1] = slopeX;
              data[at + 2] = slopeY;
              data[at + 3] = slopeZ;
              at += 4;
            }
          }
        }
      }
    }
  }
  return data;
}
