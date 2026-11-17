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

/** The share of the GALAXY_GLOW_FRAGMENT light that the clouds carry, from 0 to 1. At 1 the flat picture itself is not visible. */
export const CLOUD_SHARE = 1;
/** The clouds add up in display brightness while the glow adds up in linear light, so this factor roughly matches the two. */
const SCREEN_BOOST = 2.2;
/** The darkening of a dust cloud at its centre. */
const DUST_DEPTH = 0.06;

/** Draws the galaxy as a volume: first additive light clouds, then dust that darkens everything drawn before it. */
export class GalaxyCloudsView {
  readonly group = new Group();
  private light: Points<BufferGeometry, RawShaderMaterial> | null = null;
  private dust: Points<BufferGeometry, RawShaderMaterial> | null = null;
  private worker: Worker | null = null;
  private disposed = false;

  get ready(): boolean {
    return this.light !== null;
  }

  /**
   * `picture` is the top-down galaxy image as linear RGB, `size` × `size`.
   * `onClusters` receives the generated star clusters so they can be drawn among the stars.
   */
  constructor(picture: Promise<Float32Array>, size: number, onClusters: (data: Float32Array) => void) {
    picture.then(
      (rgb) => {
        if (this.disposed) return;
        // This is the total light of the picture, summed as brightness times pixel area.
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
        // Generation takes a few hundred milliseconds, so it runs in a worker to keep the map responsive.
        // If the browser cannot start the worker, the clouds are generated on the main thread instead.
        const request: CloudsRequest = { rgb, size };
        try {
          this.worker = new Worker(new URL("./galaxyClouds.worker.ts", import.meta.url));
          this.worker.onmessage = (event: MessageEvent<GalaxyClouds>) => show(event.data);
          this.worker.onerror = () => show(galaxyClouds(rgb, size));
          this.worker.postMessage(request);
        } catch {
          show(galaxyClouds(rgb, size));
        }
      },
      // If the picture fails to load, no clouds are drawn and the galaxy keeps its flat glow.
      () => {},
    );
  }

  /** `fade` goes from 0 inside the disc, where the clouds would only blur the view, to 1 outside. */
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
    // Light clouds add up, while dust keeps only part of what is behind it.
    blendSrc: dust ? ZeroFactor : OneFactor,
    blendDst: dust ? OneMinusSrcAlphaFactor : OneFactor,
  });
}
