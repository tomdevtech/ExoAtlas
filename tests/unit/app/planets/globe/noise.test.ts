import { describe, expect, it } from "vitest";
import { NOISE_PERIOD, NOISE_SIZE, noiseAt, noiseVolume, pcg3d } from "@/app/planets/globe/noise";

/** The noise exactly as the shader used to calculate it, without repeating. */
function shaderNoise(x: number, y: number, z: number): number {
  const i = [Math.floor(x), Math.floor(y), Math.floor(z)];
  const f = [x - i[0], y - i[1], z - i[2]];
  const u = f.map((t) => t * t * t * (t * (t * 6 - 15) + 10));
  const corner = (dx: number, dy: number, dz: number) => {
    const hash = pcg3d(i[0] + dx + 65536, i[1] + dy + 65536, i[2] + dz + 65536);
    const g = hash.map((h) => (h / 4294967295) * 2 - 1);
    return g[0] * (f[0] - dx) + g[1] * (f[1] - dy) + g[2] * (f[2] - dz);
  };
  const mix = (a: number, b: number, t: number) => a + (b - a) * t;
  return mix(
    mix(mix(corner(0, 0, 0), corner(1, 0, 0), u[0]), mix(corner(0, 1, 0), corner(1, 1, 0), u[0]), u[1]),
    mix(mix(corner(0, 0, 1), corner(1, 0, 1), u[0]), mix(corner(0, 1, 1), corner(1, 1, 1), u[0]), u[1]),
    u[2],
  );
}

const points: [number, number, number][] = [
  [0.3, 0.7, 0.1],
  [2.25, 5.5, 3.9],
  [6.01, 1.99, 4.5],
  [3.333, 0.125, 6.875],
];

describe("noiseAt", () => {
  it("is the noise the shader used to calculate, inside one period", () => {
    for (const [x, y, z] of points) {
      expect(noiseAt(x, y, z)[0]).toBeCloseTo(shaderNoise(x, y, z), 12);
    }
  });

  it("gives the exact slope", () => {
    const step = 1e-6;
    for (const [x, y, z] of points) {
      const [value, sx, sy, sz] = noiseAt(x, y, z);
      expect(sx).toBeCloseTo((noiseAt(x + step, y, z)[0] - value) / step, 4);
      expect(sy).toBeCloseTo((noiseAt(x, y + step, z)[0] - value) / step, 4);
      expect(sz).toBeCloseTo((noiseAt(x, y, z + step)[0] - value) / step, 4);
    }
  });

  it("repeats without a seam", () => {
    for (const [x, y, z] of points) {
      const shifted = noiseAt(x + NOISE_PERIOD, y - NOISE_PERIOD, z + 2 * NOISE_PERIOD);
      noiseAt(x, y, z).forEach((value, i) => expect(shifted[i]).toBeCloseTo(value, 9));
    }
  });
});

describe("noiseVolume", () => {
  it("holds noise and slope for every texel", () => {
    const volume = noiseVolume();
    expect(volume).toHaveLength(NOISE_SIZE ** 3 * 4);
    // Texel (8, 0, 0) lies on the lattice point (1, 0, 0), where the noise is 0.
    expect(volume[8 * 4]).toBeCloseTo(0, 6);
    const steps = NOISE_SIZE / NOISE_PERIOD;
    for (const [x, y, z] of [
      [5, 2, 3],
      [61, 40, 17],
      [63, 63, 63],
      [8, 33, 56],
    ]) {
      const texel = ((z * NOISE_SIZE + y) * NOISE_SIZE + x) * 4;
      const expected = noiseAt(x / steps, y / steps, z / steps);
      expected.forEach((value, i) => expect(volume[texel + i]).toBeCloseTo(value, 5));
    }
  });
});
