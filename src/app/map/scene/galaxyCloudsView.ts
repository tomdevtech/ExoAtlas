import {
  BufferAttribute,
  BufferGeometry,
  CustomBlending,
  GLSL3,
  Group,
  OneFactor,
  OneMinusSrcAlphaFactor,
  Points,
  RawShaderMaterial,
  ZeroFactor,
  Vector3,
} from "three";
import { CLOUD_STRIDE, galaxyClouds, type GalaxyClouds } from "../galaxyClouds";
import { GALAXY_PICTURE_WIDTH } from "../galaxy";
import type { CloudsRequest } from "./galaxyClouds.worker";
import { CLOUDS_FRAGMENT, CLOUDS_VERTEX, DUST_FRAGMENT } from "./shaders";

/**
 * How much of the light of the sheet of GALAXY_GLOW_FRAGMENT the clouds
 * carry: all of it, so that the picture itself is not seen, only the clouds
 * and clusters made after it.
 */
export const CLOUD_SHARE = 1;
/**
 * The clouds add up their light in the brightness of the screen, the glow of
 * the galaxy in linear light that is then brightened for the screen. This
 * brings the clouds to about the same brightness.
 */
const SCREEN_BOOST = 2.2;
/** How dark a cloud of dust is at its middle. */
const DUST_DEPTH = 0.06;

/**
 * Draws the galaxy as a body (galaxyClouds.ts) once the picture is there:
 * the clouds of light first, then the dust, which darkens what was drawn
 * before it: the glow of the galaxy and the clouds, most visibly in front of
 * the bulge.
 */
export class GalaxyCloudsView {
  readonly group = new Group();
  private light: Points<BufferGeometry, RawShaderMaterial> | null = null;
  private dust: Points<BufferGeometry, RawShaderMaterial> | null = null;
  private worker: Worker | null = null;
  private disposed = false;

  /** Whether the clouds are there to be drawn. */
  get ready(): boolean {
    return this.light !== null;
  }

  /**
   * `picture` is the picture of the galaxy from above as linear red, green
   * and blue, `size` × `size` (picture.ts). `onClusters` gets the clusters of
   * stars made after it, to draw among the stars.
   */
  constructor(picture: Promise<Float32Array>, size: number, onClusters: (data: Float32Array) => void) {
    picture.then(
      (rgb) => {
        if (this.disposed) return;
        // The whole light of the picture, as brightness times area.
        const pixel = GALAXY_PICTURE_WIDTH / size;
        let total = 0;
        for (let i = 0; i < size * size; i++) {
          total += (0.3 * rgb[i * 3] + 0.6 * rgb[i * 3 + 1] + 0.1 * rgb[i * 3 + 2]) * pixel * pixel;
        }
        const show = (clouds: GalaxyClouds) => {
          this.worker?.terminate();
          this.worker = null;
          if (this.disposed) return;
          this.light = new Points(geometry(clouds.light), material(CLOUDS_FRAGMENT, total * CLOUD_SHARE * SCREEN_BOOST, false));
          this.dust = new Points(geometry(clouds.dust), material(DUST_FRAGMENT, DUST_DEPTH, true));
          this.light.renderOrder = 1.05;
          this.dust.renderOrder = 1.1;
          onClusters(clouds.clusters);
          for (const points of [this.light, this.dust]) {
            points.frustumCulled = false;
            this.group.add(points);
          }
        };
        // Placing the clouds takes a few hundred milliseconds. A worker does
        // it beside the map, which would stand still for that long otherwise.
        const request: CloudsRequest = { rgb, size };
        try {
          this.worker = new Worker(new URL("./galaxyClouds.worker.ts", import.meta.url));
          this.worker.onmessage = (event: MessageEvent<GalaxyClouds>) => show(event.data);
          // A browser that cannot start the worker makes the clouds here.
          this.worker.onerror = () => show(galaxyClouds(rgb, size));
          this.worker.postMessage(request);
        } catch {
          show(galaxyClouds(rgb, size));
        }
      },
      // Without the picture the galaxy stays as flat as the picture would have been.
      () => {},
    );
  }

  /** `fade` is 0 inside the disc, where the clouds would only blur the view, and 1 outside. */
  update(pixelsPerUnit: number, pixelRatio: number, fade: number, eye: Vector3): void {
    for (const points of [this.light, this.dust]) {
      if (!points) continue;
      const uniforms = points.material.uniforms;
      (uniforms.uEye.value as Vector3).copy(eye);
      uniforms.uPixelsPerUnit.value = pixelsPerUnit;
      uniforms.uPixelRatio.value = pixelRatio;
      uniforms.uFade.value = fade;
      points.visible = fade > 0.001;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
    for (const points of [this.light, this.dust]) {
      points?.geometry.dispose();
      points?.material.dispose();
    }
  }
}

function geometry(data: Float32Array): BufferGeometry {
  const count = data.length / CLOUD_STRIDE;
  const position = new Float32Array(count * 3);
  const color = new Float32Array(count * 3);
  const radius = new Float32Array(count);
  const share = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const at = i * CLOUD_STRIDE;
    position.set(data.subarray(at, at + 3), i * 3);
    color.set(data.subarray(at + 3, at + 6), i * 3);
    radius[i] = data[at + 6];
    share[i] = data[at + 7];
  }
  const result = new BufferGeometry();
  result.setAttribute("position", new BufferAttribute(position, 3));
  result.setAttribute("color", new BufferAttribute(color, 3));
  result.setAttribute("radius", new BufferAttribute(radius, 1));
  result.setAttribute("share", new BufferAttribute(share, 1));
  return result;
}

function material(fragmentShader: string, gain: number, dust: boolean): RawShaderMaterial {
  return new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: CLOUDS_VERTEX,
    fragmentShader,
    uniforms: {
      uPixelsPerUnit: { value: 1 },
      uPixelRatio: { value: 1 },
      uGain: { value: gain },
      uFade: { value: 0 },
      uDust: { value: dust ? 1 : 0 },
      uEye: { value: new Vector3() },
    },
    depthTest: false,
    depthWrite: false,
    transparent: true,
    blending: CustomBlending,
    // Light adds up; dust keeps only a share of what is behind it.
    blendSrc: dust ? ZeroFactor : OneFactor,
    blendDst: dust ? OneMinusSrcAlphaFactor : OneFactor,
  });
}
