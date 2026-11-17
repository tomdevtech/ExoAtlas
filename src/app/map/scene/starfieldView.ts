import {
  BufferAttribute,
  BufferGeometry,
  CustomBlending,
  DoubleSide,
  GLSL3,
  Group,
  Mesh,
  OneFactor,
  PlaneGeometry,
  Points,
  RawShaderMaterial,
  type Camera,
} from "three";
import { clusterStars, globularSystem, LANDMARKS, type Landmark, type LandmarkKind } from "../landmarks";
import {
  cellKey,
  cellsAround,
  cellSize,
  cellStars,
  planFromPicture,
  reachAt,
  SMOOTH_PLAN,
  STAR_CLASSES,
  type CellStars,
  type Plan,
} from "../starfield";
import { FIELD_FRAGMENT, FIELD_VERTEX, LANDMARK_FRAGMENT, LANDMARK_VERTEX } from "./shaders";

/** Time budget in milliseconds per frame for generating new star cells, so that flying stays smooth. */
const BUDGET_MS = 3;
/** A landmark is labelled within this many of its radii, but always within NAMED_AT_LEAST parsecs. */
const NAMED_WITHIN = 40;
const NAMED_AT_LEAST = 120;

const additive = { blending: CustomBlending, blendSrc: OneFactor, blendDst: OneFactor } as const;

/** Landmark kinds in the order in which LANDMARK_FRAGMENT numbers them. */
const LANDMARK_KINDS: readonly LandmarkKind[] = ["nebula", "cluster", "globular", "planetary", "remnant", "galaxy"];
/** Size of the glow in landmark radii, because the faint outskirts reach well beyond the bright core. */
const GLOW_SIZE: Record<LandmarkKind, number> = {
  nebula: 3.2,
  cluster: 3,
  globular: 3,
  planetary: 1.6,
  remnant: 1.4,
  galaxy: 1.5,
};
/** No landmark is labelled beyond this distance in parsecs, however large it is. */
const NAMED_AT_MOST = 15000;
/**
 * Luminosity over distance squared (solar luminosities per square parsec) below which a star is
 * invisible. FIELD_VERTEX uses the same threshold, so the two must stay in sync.
 */
export const FAINTEST = 2e-6;

/** Render state for one star class from starfield.ts. */
interface Layer {
  index: number;
  points: Points<BufferGeometry, RawShaderMaterial>;
  /** Generated stars, keyed by cell. */
  made: Map<string, CellStars>;
  /** The cells the camera needs now, and those of them that are not generated yet. */
  wanted: { key: string; cell: [number, number, number] }[];
  waiting: { key: string; cell: [number, number, number] }[];
  /** The key the `wanted` cells were computed for, and the key of the stars currently uploaded. */
  wantedFor: string;
  drawnFor: string;
  reach: number;
  /** The camera position at the time `wanted` was computed. */
  from: [number, number, number];
}

/**
 * Draws the procedural stars around the camera and the landmarks. Missing cells are generated within
 * BUDGET_MS per frame, and a class is uploaded only once all its cells exist, so that nothing flickers.
 */
export class StarfieldView {
  readonly group = new Group();
  private plan: Plan = SMOOTH_PLAN;
  /** Far-reaching classes follow the spiral arms, so they wait until the plan from the picture is ready. */
  private planReady = false;
  private readonly layers: Layer[];
  private readonly landmarks: {
    landmark: Landmark;
    glow: Mesh<PlaneGeometry, RawShaderMaterial>;
    members: Points<BufferGeometry, RawShaderMaterial> | null;
  }[] = [];
  private disposed = false;
  private readonly globulars: Points<BufferGeometry, RawShaderMaterial>;
  /** The star clusters in the spiral arms from galaxyClouds.ts, once they have been generated. */
  private clusters: Points<BufferGeometry, RawShaderMaterial> | null = null;

  /** `picture` is the top-down galaxy image as linear RGB, `size` × `size`, from which the arm plan is derived. */
  constructor(picture: Promise<Float32Array>, size: number) {
    this.layers = STAR_CLASSES.map((_, index) => {
      const points = new Points(new BufferGeometry(), fieldMaterial());
      points.frustumCulled = false;
      points.renderOrder = 1.5;
      this.group.add(points);
      return { index, points, made: new Map(), wanted: [], waiting: [], wantedFor: "", drawnFor: "", reach: 0, from: [0, 0, 0] };
    });

    LANDMARKS.forEach((landmark, index) => {
      const glow = new Mesh(
        new PlaneGeometry(2, 2),
        new RawShaderMaterial({
          glslVersion: GLSL3,
          vertexShader: LANDMARK_VERTEX,
          fragmentShader: LANDMARK_FRAGMENT,
          uniforms: {
            uColor: { value: landmark.color },
            uKind: { value: LANDMARK_KINDS.indexOf(landmark.kind) },
            uSeed: { value: (index * 3.7) % 17 },
            uFade: { value: 1 },
          },
          depthTest: false,
          depthWrite: false,
          transparent: true,
          side: DoubleSide,
          ...additive,
        }),
      );
      glow.position.set(...landmark.position);
      glow.scale.setScalar(landmark.radius * GLOW_SIZE[landmark.kind]);
      glow.renderOrder = 1.4;
      glow.frustumCulled = false;
      this.group.add(glow);
      let members: Points<BufferGeometry, RawShaderMaterial> | null = null;
      if (landmark.members > 0) {
        members = new Points(starGeometry(clusterStars(landmark, index)), fieldMaterial());
        members.frustumCulled = false;
        members.renderOrder = 1.5;
        members.material.uniforms.uReach.value = 1e9;
        this.group.add(members);
      }
      this.landmarks.push({ landmark, glow, members });
    });

    this.globulars = new Points(starGeometry(globularSystem()), fieldMaterial());
    this.globulars.frustumCulled = false;
    this.globulars.renderOrder = 1.5;
    this.globulars.material.uniforms.uReach.value = 1e9;
    this.group.add(this.globulars);

    picture.then(
      (rgb) => {
        if (this.disposed) return;
        this.plan = planOf(rgb, size);
        this.planReady = true;
      },
      // If the picture fails to load, the smooth default plan is kept, which still looks like a galaxy.
      () => {
        this.planReady = true;
      },
    );
  }

  /**
   * Updates the stars for the current camera. `photographed` is the opacity of the sky photo, from 0 to 1
   * (1 near the Sun). Stars that the photo already shows stay hidden until it fades out.
   */
  update(camera: Camera, photographed: number, pixelRatio: number): void {
    const { x, y, z } = camera.position;
    for (const layer of this.layers) {
      const starClass = STAR_CLASSES[layer.index];
      const uniforms = layer.points.material.uniforms;
      uniforms.uPixelRatio.value = pixelRatio;
      uniforms.uFade.value = 1 - photographed * (starClass.photographed ? 1 : 0.8);
      // Far classes depend on the arm plan; near classes look the same with or without it.
      if (starClass.reach > 200 && !this.planReady) continue;
      const reach = reachAt(starClass, this.plan, x, y, z);
      const size = cellSize(starClass);
      // The reach is rounded to steps of 0.1 in log space so that a slowly changing reach does not request new cells every frame.
      const steps = Math.round(Math.log(reach) * 10);
      const wantedFor = `${Math.floor(x / size)}:${Math.floor(y / size)}:${Math.floor(z / size)}:${steps}`;
      if (wantedFor !== layer.wantedFor) {
        layer.wantedFor = wantedFor;
        layer.reach = Math.exp(steps / 10);
        layer.from = [x, y, z];
        layer.wanted = cellsAround(layer.index, layer.reach, x, y, z).map((cell) => ({
          key: cellKey(layer.index, ...cell),
          cell,
        }));
        layer.waiting = layer.wanted.filter((item) => !layer.made.has(item.key));
      }
    }

    // Missing cells are generated nearest classes first until the frame budget is used up.
    const started = performance.now();
    for (const layer of this.layers) {
      while (layer.waiting.length > 0 && performance.now() - started < BUDGET_MS) {
        const { key, cell } = layer.waiting.shift() as (typeof layer.waiting)[number];
        if (!layer.made.has(key)) layer.made.set(key, cellStars(layer.index, ...cell, this.plan));
      }
      if (layer.waiting.length === 0 && layer.drawnFor !== layer.wantedFor && layer.wantedFor !== "") {
        this.draw(layer);
      }
    }

    this.globulars.material.uniforms.uPixelRatio.value = pixelRatio;
    this.globulars.material.uniforms.uFade.value = 1 - photographed;
    if (this.clusters) this.clusters.material.uniforms.uPixelRatio.value = pixelRatio;
    // Near the Sun the photo already shows the landmarks, so they are hidden instead of drawn with zero light.
    const shown = photographed < 0.999;
    this.globulars.visible = shown;
    for (const { glow, members } of this.landmarks) {
      glow.visible = shown;
      if (members) members.visible = shown;
      if (!shown) continue;
      glow.quaternion.copy(camera.quaternion);
      glow.material.uniforms.uFade.value = 1 - photographed;
      if (members) {
        members.material.uniforms.uPixelRatio.value = pixelRatio;
        members.material.uniforms.uFade.value = 1 - photographed;
      }
    }
  }

  /** Adds the spiral-arm star clusters, packed as seven floats per star. */
  addClusters(data: Float32Array): void {
    if (this.disposed) return;
    this.clusters = new Points(starGeometry(data), fieldMaterial());
    this.clusters.frustumCulled = false;
    this.clusters.renderOrder = 1.5;
    this.clusters.material.uniforms.uReach.value = 1e9;
    this.group.add(this.clusters);
  }

  /**
   * Sets the opacity of the arm clusters, from 0 to 1. They are only shown from outside the disc, because
   * inside it the cell stars take over and a nearby cluster would appear as a glaring point.
   */
  showClusters(amount: number): void {
    if (!this.clusters) return;
    this.clusters.material.uniforms.uFade.value = amount;
    this.clusters.visible = amount > 0.001;
  }

  /** Uploads the stars of the cells a layer needs and discards all other cells. */
  private draw(layer: Layer): void {
    let count = 0;
    for (const { key } of layer.wanted) count += layer.made.get(key)?.count ?? 0;
    const data = new Float32Array(count * 7);
    let at = 0;
    const keep = new Set<string>();
    // Most stars are too faint to see. The cells only refresh once the camera leaves its cell, so a star
    // that stays too faint even from the closest reachable point is skipped to save GPU work.
    const [cx, cy, cz] = layer.from;
    const margin = cellSize(STAR_CLASSES[layer.index]) * 1.8;
    for (const { key } of layer.wanted) {
      const stars = layer.made.get(key);
      if (!stars) continue;
      keep.add(key);
      const source = stars.data;
      for (let i = 0; i < source.length; i += 7) {
        const closest = Math.max(Math.hypot(source[i] - cx, source[i + 1] - cy, source[i + 2] - cz) - margin, 0.01);
        if (closest > layer.reach || source[i + 6] / (closest * closest) < FAINTEST) continue;
        data.set(source.subarray(i, i + 7), at);
        at += 7;
      }
    }
    for (const key of layer.made.keys()) if (!keep.has(key)) layer.made.delete(key);
    layer.points.geometry.dispose();
    layer.points.geometry = starGeometry(data.subarray(0, at));
    layer.points.material.uniforms.uReach.value = layer.reach;
    layer.drawnFor = layer.wantedFor;
  }

  /** Returns the landmarks that are close enough to label, with their positions. */
  namedLandmarks(camera: Camera): { name: string; position: [number, number, number] }[] {
    return this.landmarks
      .filter(({ landmark }) => {
        const [lx, ly, lz] = landmark.position;
        const distance = Math.hypot(lx - camera.position.x, ly - camera.position.y, lz - camera.position.z);
        return distance < Math.max(NAMED_AT_LEAST, Math.min(NAMED_AT_MOST, landmark.radius * NAMED_WITHIN));
      })
      .map(({ landmark }) => ({ name: landmark.name, position: landmark.position }));
  }

  /** The number of field stars currently uploaded, used by tests and measurements. */
  get starCount(): number {
    return this.layers.reduce((sum, layer) => sum + (layer.points.geometry.getAttribute("position")?.count ?? 0), 0);
  }

  dispose(): void {
    this.disposed = true;
    for (const layer of this.layers) {
      layer.points.geometry.dispose();
      layer.points.material.dispose();
    }
    this.globulars.geometry.dispose();
    this.globulars.material.dispose();
    this.clusters?.geometry.dispose();
    this.clusters?.material.dispose();
    for (const { glow, members } of this.landmarks) {
      glow.geometry.dispose();
      glow.material.dispose();
      members?.geometry.dispose();
      members?.material.dispose();
    }
  }
}

function fieldMaterial(): RawShaderMaterial {
  return new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: FIELD_VERTEX,
    fragmentShader: FIELD_FRAGMENT,
    uniforms: { uPixelRatio: { value: 1 }, uReach: { value: 1 }, uFade: { value: 1 } },
    depthTest: false,
    depthWrite: false,
    transparent: true,
    ...additive,
  });
}

/** Builds geometry from stars packed as seven floats each: position, colour and luminosity. */
function starGeometry(data: Float32Array): BufferGeometry {
  const count = data.length / 7;
  const position = new Float32Array(count * 3);
  const color = new Float32Array(count * 3);
  const light = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    position[i * 3] = data[i * 7];
    position[i * 3 + 1] = data[i * 7 + 1];
    position[i * 3 + 2] = data[i * 7 + 2];
    color[i * 3] = data[i * 7 + 3];
    color[i * 3 + 1] = data[i * 7 + 4];
    color[i * 3 + 2] = data[i * 7 + 5];
    light[i] = data[i * 7 + 6];
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(position, 3));
  geometry.setAttribute("color", new BufferAttribute(color, 3));
  geometry.setAttribute("light", new BufferAttribute(light, 1));
  return geometry;
}

/**
 * Derives the galaxy plan from the picture's brightness, downsampled by two. The downsampling makes
 * the stars follow the arms rather than every small knot in the painting.
 */
function planOf(rgb: Float32Array, size: number): Plan {
  const half = size / 2;
  const brightness = new Float32Array(half * half);
  for (let row = 0; row < half; row++) {
    for (let column = 0; column < half; column++) {
      let sum = 0;
      for (const at of [2 * row * size + 2 * column, 2 * row * size + 2 * column + 1, (2 * row + 1) * size + 2 * column, (2 * row + 1) * size + 2 * column + 1]) {
        // Summing linear light makes the bright arms weigh more than their sRGB grey would suggest.
        sum += 0.3 * rgb[at * 3] + 0.6 * rgb[at * 3 + 1] + 0.1 * rgb[at * 3 + 2];
      }
      brightness[row * half + column] = sum / 4;
    }
  }
  return planFromPicture(brightness, half);
}
