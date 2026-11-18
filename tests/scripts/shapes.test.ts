import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  equalVolumeRadius,
  GRID_HEIGHT,
  GRID_WIDTH,
  gridDirection,
  packGrid,
  parseObj,
  radiusGrid,
  unzipFirst,
  type Mesh,
} from "../../scripts/shapes";
import { SHAPE_SOURCES, shapeGrid } from "@/app/solar-system/shapes";

/** A UV sphere stretched to an ellipsoid with semi-axes a, b and c along x, y and z. */
function ellipsoid(a: number, b: number, c: number, steps = 48): Mesh {
  const positions: number[] = [];
  const triangles: number[] = [];
  for (let row = 0; row <= steps; row++) {
    const latitude = Math.PI / 2 - (Math.PI * row) / steps;
    for (let column = 0; column < steps * 2; column++) {
      const longitude = (Math.PI * column) / steps;
      positions.push(a * Math.cos(latitude) * Math.cos(longitude), b * Math.cos(latitude) * Math.sin(longitude), c * Math.sin(latitude));
    }
  }
  const at = (row: number, column: number) => row * steps * 2 + (column % (steps * 2));
  for (let row = 0; row < steps; row++) {
    for (let column = 0; column < steps * 2; column++) {
      triangles.push(at(row, column), at(row + 1, column), at(row + 1, column + 1));
      triangles.push(at(row, column), at(row + 1, column + 1), at(row, column + 1));
    }
  }
  return { positions: Float64Array.from(positions), triangles: Uint32Array.from(triangles) };
}

/** A ZIP archive with one deflated file, laid out as the APL's archives are. */
function zip(name: string, content: Buffer): Buffer {
  const data = deflateRawSync(content);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  const directoryAt = local.length + name.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(directoryAt, 16);
  return Buffer.concat([local, Buffer.from(name), data, central, Buffer.from(name), end]);
}

describe("unzipFirst", () => {
  it("reads the first file of an archive", () => {
    const content = Buffer.from("v 1 2 3\n".repeat(500));
    expect(unzipFirst(zip("model.obj", content)).equals(content)).toBe(true);
  });

  it("refuses what is not an archive", () => {
    expect(() => unzipFirst(Buffer.alloc(100))).toThrow(/ZIP/);
  });
});

describe("parseObj", () => {
  it("reads vertices and fans faces into triangles, ignoring texture and normal indices", () => {
    const mesh = parseObj("# comment\nv 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nvn 0 0 1\nf 1/1/1 2/2/1 3/3/1 4/4/1\n");
    expect(Array.from(mesh.positions)).toEqual([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
    expect(Array.from(mesh.triangles)).toEqual([0, 1, 2, 0, 2, 3]);
  });

  it("refuses broken files", () => {
    expect(() => parseObj("v 0 0 x\n")).toThrow(/not a number/);
    expect(() => parseObj("v 0 0 0\nf 1 2 3\n")).toThrow(/missing vertex/);
  });
});

describe("radiusGrid", () => {
  it("finds the radius of an ellipsoid in every direction", () => {
    const [a, b, c] = [13, 11, 9];
    const grid = radiusGrid(ellipsoid(a, b, c));
    expect(grid).toHaveLength((GRID_HEIGHT + 1) * GRID_WIDTH);
    for (const [column, row] of [[0, 64], [64, 64], [128, 64], [200, 30], [17, 100], [5, 0], [99, 128]]) {
      const [x, y, z] = gridDirection(column, row);
      const exact = 1 / Math.sqrt((x / a) ** 2 + (y / b) ** 2 + (z / c) ** 2);
      // The faceted model lies a little inside the true ellipsoid between its vertices.
      expect(grid[row * GRID_WIDTH + column] / exact).toBeGreaterThan(0.995);
      expect(grid[row * GRID_WIDTH + column] / exact).toBeLessThanOrEqual(1.0001);
    }
  });

  it("gives the radius of equal volume, which the published models state", () => {
    const grid = radiusGrid(ellipsoid(13, 11, 9));
    expect(equalVolumeRadius(grid)).toBeCloseTo(Math.cbrt(13 * 11 * 9), 1);
  });
});

describe("packGrid", () => {
  it("keeps every radius to a 65,535th of the largest", () => {
    const grid = Float32Array.from({ length: (GRID_HEIGHT + 1) * GRID_WIDTH }, (_, i) => 5 + (i % 97) / 10);
    const { bytes, maxRadius } = packGrid(grid);
    expect(bytes.length).toBe(grid.length * 2);
    expect(maxRadius).toBeCloseTo(14.6, 4);
    for (let i = 0; i < grid.length; i += 501) expect((bytes.readUInt16LE(i * 2) / 65535) * maxRadius).toBeCloseTo(grid[i], 3);
  });
});

describe("the shape sources", () => {
  it("each have a grid whose volume matches the body's published mean radius", () => {
    // Mean radii from JPL and the shape-model papers.
    const published: Record<string, number> = {
      vesta: 261.4,
      phobos: 11.08,
      deimos: 6.2,
      hyperion: 135,
      pan: 14,
      daphnis: 3.8,
      atlas: 15.1,
      prometheus: 43.1,
      pandora: 40.6,
      epimetheus: 58.2,
      janus: 89.2,
      telesto: 12.4,
      calypso: 9.6,
      helene: 18,
      phoebe: 106.5,
    };
    for (const slug of Object.keys(SHAPE_SOURCES)) {
      const grid = shapeGrid(slug);
      expect(grid, slug).not.toBeNull();
      expect(grid!.meanRadiusKm / published[slug], slug).toBeCloseTo(1, 1);
      expect(grid!.maxRadiusKm, slug).toBeGreaterThan(grid!.meanRadiusKm);
    }
  });
});
