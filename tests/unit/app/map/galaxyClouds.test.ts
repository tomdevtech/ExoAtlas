import { describe, expect, it } from "vitest";
import { GALACTIC_CENTRE, GALAXY_EDGE, GALAXY_PICTURE_WIDTH } from "@/app/map/galaxy";
import { BULGE_CLOUDS, CLOUD_STRIDE, CLUSTERS, DUST_CLOUDS, galaxyClouds, HALO_CLOUDS, LIGHT_CLOUDS, THIN } from "@/app/map/galaxyClouds";

/**
 * Builds a small synthetic galaxy picture seen from above: a bright yellow
 * core, a blue ring of young stars, a dark lane just inside the ring and black
 * beyond. Rows run from the top, as galaxyClouds expects.
 */
function picture(size: number): Float32Array {
  const rgb = new Float32Array(size * size * 3);
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const dx = ((column + 0.5) / size - 0.5) * GALAXY_PICTURE_WIDTH;
      const dy = ((row + 0.5) / size - 0.5) * GALAXY_PICTURE_WIDTH;
      const r = Math.hypot(dx, dy);
      const i = (row * size + column) * 3;
      if (r < 1500) rgb.set([0.6, 0.5, 0.25], i);
      else if (r > 6000 && r < 6600) rgb.set([0.02, 0.02, 0.02], i);
      else if (r > 7000 && r < 9000) rgb.set([0.15, 0.25, 0.5], i);
      else if (r < 12000) rgb.set([0.08, 0.08, 0.08], i);
    }
  }
  return rgb;
}

const size = 128;
const clouds = galaxyClouds(picture(size), size);

/** Unpacks the flat cloud list into objects. */
function each(data: Float32Array) {
  const out: { x: number; y: number; z: number; r: number; g: number; b: number; radius: number; share: number; fromCentre: number }[] = [];
  for (let i = 0; i < data.length; i += CLOUD_STRIDE) {
    const [x, y, z, r, g, b, radius, share] = data.slice(i, i + CLOUD_STRIDE);
    out.push({ x, y, z, r, g, b, radius, share, fromCentre: Math.hypot(x - GALACTIC_CENTRE[0], y - GALACTIC_CENTRE[1]) });
  }
  return out;
}

const light = each(clouds.light).slice(0, LIGHT_CLOUDS);
const dust = each(clouds.dust);

/** Returns a quantile (the median by default) of the cloud heights, which is robust against a few outliers. */
function spread(list: { z: number }[], quantile = 0.5): number {
  const heights = list.map((item) => Math.abs(item.z)).sort((a, b) => a - b);
  return heights[Math.floor(heights.length * quantile)];
}

describe("the galaxy as a body", () => {
  it("is the same every time for the same picture", () => {
    const again = galaxyClouds(picture(size), size);
    expect(Array.from(again.light.slice(0, 800))).toEqual(Array.from(clouds.light.slice(0, 800)));
    expect(clouds.light.length).toBe((LIGHT_CLOUDS + HALO_CLOUDS + BULGE_CLOUDS) * CLOUD_STRIDE);
    expect(clouds.dust.length).toBe(DUST_CLOUDS * CLOUD_STRIDE);
    expect(clouds.clusters.length).toBe(CLUSTERS * 7);
  });

  it("makes clusters of stars where the picture is bright, bright enough to see from afar", () => {
    const fromCentre: number[] = [];
    let bright = 0;
    for (let i = 0; i < clouds.clusters.length; i += 7) {
      const [x, y, , , , , suns] = clouds.clusters.slice(i, i + 7);
      fromCentre.push(Math.hypot(x - GALACTIC_CENTRE[0], y - GALACTIC_CENTRE[1]));
      if (suns > 50_000) bright++;
    }
    for (const r of fromCentre) expect(r).toBeLessThan(12_500);
    const inRing = fromCentre.filter((r) => r > 7000 && r < 9000).length;
    const inLane = fromCentre.filter((r) => r > 6100 && r < 6500).length;
    expect(inRing).toBeGreaterThan(inLane * 10);
    expect(bright).toBeGreaterThan(CLUSTERS * 0.05);
  });

  it("puts its light where the picture is bright, and none where it is black", () => {
    // The thick-disc clouds are scattered around their place, so a few may lie beyond the edge.
    const beyond = light.filter((cloud) => cloud.fromCentre > 12_500).length;
    expect(beyond / light.length).toBeLessThan(0.02);
    for (const cloud of light) expect(cloud.fromCentre).toBeLessThan(12_500 + 6000);
    const inRing = light.filter((cloud) => cloud.fromCentre > 7000 && cloud.fromCentre < 9000).length;
    const inLane = light.filter((cloud) => cloud.fromCentre > 6100 && cloud.fromCentre < 6500).length;
    expect(inRing).toBeGreaterThan(inLane * 10);
    // Every cloud carries the same share, and together they carry all the light.
    const total = light.reduce((sum, cloud) => sum + cloud.share, 0);
    expect(total).toBeCloseTo(1, 3);
  });

  it("keeps the young blue clouds closer to the plane than the old ones, and swells in the bulge", () => {
    const young = light.filter((cloud) => cloud.fromCentre > 7000 && cloud.fromCentre < 9000);
    const old = light.filter((cloud) => cloud.fromCentre > 9500 && cloud.fromCentre < 11500);
    const bulge = light.filter((cloud) => cloud.fromCentre < 1000);
    expect(young.length).toBeGreaterThan(100);
    expect(old.length).toBeGreaterThan(100);
    expect(spread(young)).toBeLessThan(spread(old));
    expect(spread(bulge)).toBeGreaterThan(spread(old) * 2);
    const blue = young.reduce((sum, cloud) => sum + cloud.b - cloud.r, 0) / young.length;
    const yellow = bulge.reduce((sum, cloud) => sum + cloud.r - cloud.b, 0) / bulge.length;
    expect(blue).toBeGreaterThan(0);
    expect(yellow).toBeGreaterThan(0);
  });

  it("has a bulge of its own, an oval far above and below the disc", () => {
    const bulge = each(clouds.light).slice(LIGHT_CLOUDS + HALO_CLOUDS);
    expect(bulge).toHaveLength(BULGE_CLOUDS);
    const wide = spread(bulge.map((cloud) => ({ z: cloud.fromCentre })));
    const high = spread(bulge);
    // The bulge is an oval that is wider than high but reaches higher than the disc around it.
    expect(high).toBeLessThan(wide);
    const disc = light.filter((cloud) => cloud.fromCentre > 7000 && cloud.fromCentre < 9000);
    expect(spread(bulge, 0.9)).toBeGreaterThan(spread(disc, 0.9));
    // The bulge is yellowish because its stars are old.
    for (const cloud of bulge) expect(cloud.r).toBeGreaterThan(cloud.b);
  });

  it("lays its dust in a thin sheet in the dark lane, away from the bulge and the edge", () => {
    expect(dust.length).toBeGreaterThan(0);
    const inLane = dust.filter((cloud) => cloud.fromCentre > 5800 && cloud.fromCentre < 7000).length;
    expect(inLane / dust.length).toBeGreaterThan(0.45);
    for (const cloud of dust) {
      expect(cloud.fromCentre).toBeGreaterThan(2500);
      expect(cloud.fromCentre).toBeLessThan(GALAXY_EDGE);
    }
    // The dust lies in the thin layer: 55 parsecs at true scale, exaggerated by THIN.
    expect(spread(dust)).toBeLessThan(100 * THIN);
  });
});
