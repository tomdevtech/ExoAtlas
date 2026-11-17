import { describe, expect, it } from "vitest";
import { GALACTIC_CENTRE } from "@/app/map/galaxy";
import { clusterStars, fromGalactic, globularSystem, LANDMARKS } from "@/app/map/landmarks";

describe("the globular clusters round the galaxy", () => {
  const data = globularSystem();
  const clusters = Array.from({ length: data.length / 7 }, (_, index) => {
    const [x, y, z, red, green, blue, light] = data.slice(index * 7, index * 7 + 7);
    return { fromCentre: Math.hypot(x - GALACTIC_CENTRE[0], y - GALACTIC_CENTRE[1], z - GALACTIC_CENTRE[2]), z, red, green, blue, light };
  });

  it("are the same 150 every time, seven numbers each", () => {
    expect(clusters).toHaveLength(150);
    expect(Array.from(globularSystem())).toEqual(Array.from(data));
    expect(globularSystem(12)).toHaveLength(12 * 7);
  });

  it("lie in a round halo round the centre, denser towards the middle", () => {
    for (const cluster of clusters) {
      expect(cluster.fromCentre).toBeGreaterThanOrEqual(500 - 1e-6);
      expect(cluster.fromCentre).toBeLessThanOrEqual(22_500 + 1e-6);
    }
    // The clusters form a halo rather than a disc, so many lie far above and below the plane.
    expect(clusters.filter((cluster) => Math.abs(cluster.z) > 3000).length).toBeGreaterThan(30);
    // The halo is concentrated: more clusters lie within 6 kiloparsecs than in the shell from 16 to 22, which has over four times the volume.
    const inner = clusters.filter((cluster) => cluster.fromCentre < 6000).length;
    const outer = clusters.filter((cluster) => cluster.fromCentre > 16_000).length;
    expect(inner).toBeGreaterThan(outer);
  });

  it("shine yellowish with the light of a hundred thousand suns or more", () => {
    for (const cluster of clusters) {
      expect(cluster.red).toBe(1);
      expect(cluster.green).toBeGreaterThan(cluster.blue);
      expect(cluster.light).toBeGreaterThanOrEqual(100_000);
      expect(cluster.light).toBeLessThanOrEqual(1_600_000);
    }
  });
});

describe("the landmarks of the galaxy", () => {
  it("turn galactic longitude and latitude into the coordinates of the map", () => {
    // Longitude 0 points to the galactic centre, and 90 degrees points in the direction the galaxy turns.
    expect(fromGalactic(0, 0, 8200)).toEqual([...GALACTIC_CENTRE]);
    expect(fromGalactic(90, 0, 100)).toEqual([0, 100, 0]);
    expect(fromGalactic(0, 90, 50)).toEqual([0, 0, 50]);
  });

  it("lie at their distances, with names and sizes", () => {
    const orion = LANDMARKS.find((item) => item.name === "Orion Nebula");
    expect(orion).toBeDefined();
    expect(Math.hypot(...(orion?.position ?? [0, 0, 0]))).toBeCloseTo(412, 0);
    // Orion lies roughly away from the galactic centre and south of the plane.
    expect(orion?.position[0]).toBeLessThan(0);
    expect(orion?.position[2]).toBeLessThan(0);
    for (const landmark of LANDMARKS) {
      expect(landmark.name.length).toBeGreaterThan(2);
      expect(landmark.radius).toBeGreaterThan(0);
      // Clusters and galaxies have member stars to draw, while gas clouds do not.
      expect(landmark.members > 0).toBe(["cluster", "globular", "galaxy"].includes(landmark.kind));
    }
    expect(new Set(LANDMARKS.map((item) => item.name)).size).toBe(LANDMARKS.length);
  });

  it("puts the Magellanic Clouds outside the Milky Way, far to the south", () => {
    for (const name of ["Large Magellanic Cloud", "Small Magellanic Cloud"]) {
      const cloud = LANDMARKS.find((item) => item.name === name);
      expect(cloud?.kind).toBe("galaxy");
      const [x, y, z] = cloud?.position ?? [0, 0, 0];
      expect(Math.hypot(x, y, z)).toBeGreaterThan(45_000);
      expect(z).toBeLessThan(-25_000);
    }
  });

  it("give clusters the same members every time, close around their middle", () => {
    LANDMARKS.forEach((landmark, index) => {
      if (landmark.members === 0) return;
      const stars = clusterStars(landmark, index);
      expect(stars).toEqual(clusterStars(landmark, index));
      expect(stars.length).toBe(landmark.members * 7);
      let near = 0;
      for (let n = 0; n < landmark.members; n++) {
        const [x, y, z] = stars.slice(n * 7, n * 7 + 3);
        const distance = Math.hypot(x - landmark.position[0], y - landmark.position[1], z - landmark.position[2]);
        expect(distance).toBeLessThanOrEqual(landmark.radius * 2.5 + 1e-3);
        if (distance < landmark.radius) near++;
      }
      expect(near / landmark.members).toBeGreaterThan(0.6);
    });
  });
});
