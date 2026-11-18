/**
 * Turns published shape models of irregular bodies into the compact radius grids the app draws.
 *
 * A grid holds the body's radius in every direction from its centre, on a raster of longitude and
 * latitude. That is all a body needs that is shaped like a potato rather than like a sponge, it is a
 * fraction of the size of the model, and its directions are the same as those of the body's map, so the
 * map fits without texture coordinates. Overhangs, which a ray from the centre meets twice, keep their
 * outer surface.
 */
import { inflateRawSync } from "node:zlib";

/** Raster size of a radius grid: longitude steps round the equator and latitude steps from pole to pole. */
export const GRID_WIDTH = 256;
export const GRID_HEIGHT = 128;

export interface Mesh {
  /** x, y, z of every vertex, in the model's units. */
  positions: Float64Array;
  /** Three vertex indices per triangle. */
  triangles: Uint32Array;
}

/** Reads the first file of a ZIP archive, which is how the APL publishes its shape models. */
export function unzipFirst(archive: Buffer): Buffer {
  // The central directory says how large the file really is, also when the local header leaves it open.
  let end = archive.length - 22;
  while (end >= 0 && archive.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("Not a ZIP archive: no end of central directory.");
  const directory = archive.readUInt32LE(end + 16);
  if (archive.readUInt32LE(directory) !== 0x02014b50) throw new Error("ZIP central directory not found.");
  const method = archive.readUInt16LE(directory + 10);
  const size = archive.readUInt32LE(directory + 20);
  const header = archive.readUInt32LE(directory + 42);
  const start = header + 30 + archive.readUInt16LE(header + 26) + archive.readUInt16LE(header + 28);
  const data = archive.subarray(start, start + size);
  if (method === 0) return Buffer.from(data);
  if (method === 8) return inflateRawSync(data);
  throw new Error(`ZIP compression method ${method} is not supported.`);
}

/** Reads the vertices and faces of a Wavefront OBJ file; faces with more than three corners are fanned into triangles. */
export function parseObj(text: string): Mesh {
  const positions: number[] = [];
  const triangles: number[] = [];
  for (const line of text.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === "v") positions.push(Number(parts[1]), Number(parts[2]), Number(parts[3]));
    else if (parts[0] === "f") {
      // An index may carry texture and normal indices after slashes; only the vertex counts here.
      const corners = parts.slice(1).map((part) => Number(part.split("/")[0]) - 1);
      for (let i = 1; i + 1 < corners.length; i++) triangles.push(corners[0], corners[i], corners[i + 1]);
    }
  }
  if (positions.some((value) => !Number.isFinite(value))) throw new Error("The OBJ file has a vertex that is not a number.");
  const count = positions.length / 3;
  if (triangles.some((index) => index < 0 || index >= count)) throw new Error("The OBJ file has a face with a missing vertex.");
  return { positions: Float64Array.from(positions), triangles: Uint32Array.from(triangles) };
}

/** The direction of a grid point in the model's frame (z to the north pole, x to longitude 0, y to 90° east). */
export function gridDirection(column: number, row: number): [number, number, number] {
  const longitude = -Math.PI + (2 * Math.PI * column) / GRID_WIDTH;
  const latitude = Math.PI / 2 - (Math.PI * row) / GRID_HEIGHT;
  return [Math.cos(latitude) * Math.cos(longitude), Math.cos(latitude) * Math.sin(longitude), Math.sin(latitude)];
}

/**
 * Returns the radius in every direction of the grid, row by row from the north pole, with GRID_HEIGHT + 1
 * rows (both poles included) of GRID_WIDTH columns, as the distance from the centre to the outermost point
 * where a ray in that direction leaves the mesh. The centre is the origin of the model, which is the
 * centre of mass in the published models.
 */
export function radiusGrid(mesh: Mesh): Float32Array {
  const { positions, triangles } = mesh;
  // Triangles are sorted into cells of longitude and latitude, so each ray only tests a few of them.
  const cellsX = 128;
  const cellsY = 64;
  const cells: number[][] = Array.from({ length: cellsX * cellsY }, () => []);
  const angles = (index: number): [number, number] => {
    const x = positions[index * 3];
    const y = positions[index * 3 + 1];
    const z = positions[index * 3 + 2];
    return [Math.atan2(y, x), Math.atan2(z, Math.hypot(x, y))];
  };
  const toCellX = (longitude: number) => Math.floor(((longitude + Math.PI) / (2 * Math.PI)) * cellsX);
  const toCellY = (latitude: number) => Math.min(cellsY - 1, Math.max(0, Math.floor(((Math.PI / 2 - latitude) / Math.PI) * cellsY)));
  for (let t = 0; t < triangles.length / 3; t++) {
    const corners = [angles(triangles[t * 3]), angles(triangles[t * 3 + 1]), angles(triangles[t * 3 + 2])];
    let lows = corners.map(([longitude]) => longitude);
    // A triangle across longitude 180 is unwrapped, so that its range does not span the whole globe.
    if (Math.max(...lows) - Math.min(...lows) > Math.PI) lows = lows.map((longitude) => (longitude < 0 ? longitude + 2 * Math.PI : longitude));
    const latitudes = corners.map(([, latitude]) => latitude);
    // Triangles around a pole span every longitude.
    const polar = Math.max(...latitudes.map(Math.abs)) > 1.45;
    const fromX = polar ? 0 : toCellX(Math.min(...lows)) - 1;
    const toX = polar ? cellsX - 1 : toCellX(Math.max(...lows)) + 1;
    const fromY = toCellY(Math.max(...latitudes)) - 1;
    const toY = toCellY(Math.min(...latitudes)) + 1;
    for (let cy = Math.max(0, fromY); cy <= Math.min(cellsY - 1, toY); cy++) {
      for (let cx = fromX; cx <= toX; cx++) cells[cy * cellsX + (((cx % cellsX) + cellsX) % cellsX)].push(t);
    }
  }

  const grid = new Float32Array((GRID_HEIGHT + 1) * GRID_WIDTH);
  for (let row = 0; row <= GRID_HEIGHT; row++) {
    for (let column = 0; column < GRID_WIDTH; column++) {
      const direction = gridDirection(column, row);
      const longitude = Math.atan2(direction[1], direction[0]);
      const latitude = Math.asin(Math.max(-1, Math.min(1, direction[2])));
      const candidates = cells[toCellY(latitude) * cellsX + Math.min(cellsX - 1, toCellX(longitude))];
      let farthest = 0;
      for (const t of candidates) {
        const hit = rayHit(direction, positions, triangles[t * 3], triangles[t * 3 + 1], triangles[t * 3 + 2]);
        if (hit > farthest) farthest = hit;
      }
      grid[row * GRID_WIDTH + column] = farthest;
    }
  }
  // A ray that slipped between two triangles at a shared edge finds nothing; it takes its neighbours' mean.
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] > 0) continue;
    const row = Math.floor(i / GRID_WIDTH);
    const column = i % GRID_WIDTH;
    const around = [
      grid[row * GRID_WIDTH + ((column + 1) % GRID_WIDTH)],
      grid[row * GRID_WIDTH + ((column + GRID_WIDTH - 1) % GRID_WIDTH)],
      row > 0 ? grid[i - GRID_WIDTH] : 0,
      row < GRID_HEIGHT ? grid[i + GRID_WIDTH] : 0,
    ].filter((value) => value > 0);
    if (around.length === 0) throw new Error(`No surface found around grid point ${column}, ${row}: is the origin inside the body?`);
    grid[i] = around.reduce((sum, value) => sum + value, 0) / around.length;
  }
  return grid;
}

/** Möller–Trumbore: the distance along `direction` from the origin to the triangle a, b, c, or 0 if the ray misses it. */
function rayHit(direction: number[], positions: Float64Array, a: number, b: number, c: number): number {
  const ax = positions[a * 3];
  const ay = positions[a * 3 + 1];
  const az = positions[a * 3 + 2];
  const e1x = positions[b * 3] - ax;
  const e1y = positions[b * 3 + 1] - ay;
  const e1z = positions[b * 3 + 2] - az;
  const e2x = positions[c * 3] - ax;
  const e2y = positions[c * 3 + 1] - ay;
  const e2z = positions[c * 3 + 2] - az;
  const [dx, dy, dz] = direction;
  const px = dy * e2z - dz * e2y;
  const py = dz * e2x - dx * e2z;
  const pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return 0;
  const inverse = 1 / det;
  const tx = -ax;
  const ty = -ay;
  const tz = -az;
  const u = (tx * px + ty * py + tz * pz) * inverse;
  if (u < -1e-9 || u > 1 + 1e-9) return 0;
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inverse;
  if (v < -1e-9 || u + v > 1 + 1e-9) return 0;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inverse;
  return t > 0 ? t : 0;
}

/**
 * Packs a radius grid into 16-bit steps of its largest radius, little-endian, as public/shapes/<slug>.bin.
 * Returns the bytes and the largest radius, which the app needs to unpack it.
 */
export function packGrid(grid: Float32Array): { bytes: Buffer; maxRadius: number } {
  const maxRadius = grid.reduce((largest, value) => Math.max(largest, value), 0);
  const bytes = Buffer.alloc(grid.length * 2);
  grid.forEach((value, index) => bytes.writeUInt16LE(Math.round((value / maxRadius) * 65535), index * 2));
  return { bytes, maxRadius };
}

/** The radius of the sphere with the same volume as the grid's body, by summing the cones from the centre. */
export function equalVolumeRadius(grid: Float32Array): number {
  let volume = 0;
  for (let row = 0; row < GRID_HEIGHT; row++) {
    // The band between two latitude rows, with the mean cube of the radii at its corners.
    const north = Math.PI / 2 - (Math.PI * row) / GRID_HEIGHT;
    const south = Math.PI / 2 - (Math.PI * (row + 1)) / GRID_HEIGHT;
    const band = (Math.sin(north) - Math.sin(south)) * ((2 * Math.PI) / GRID_WIDTH);
    for (let column = 0; column < GRID_WIDTH; column++) {
      const next = (column + 1) % GRID_WIDTH;
      const cube =
        (grid[row * GRID_WIDTH + column] ** 3 +
          grid[row * GRID_WIDTH + next] ** 3 +
          grid[(row + 1) * GRID_WIDTH + column] ** 3 +
          grid[(row + 1) * GRID_WIDTH + next] ** 3) /
        4;
      volume += (band * cube) / 3;
    }
  }
  return Math.cbrt((3 * volume) / (4 * Math.PI));
}
