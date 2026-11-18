import {
  BufferAttribute,
  BufferGeometry,
  type Camera,
  CustomBlending,
  GLSL3,
  HalfFloatType,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  OneFactor,
  OneMinusSrcAlphaFactor,
  OrthographicCamera,
  RawShaderMaterial,
  Scene,
  Color,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import type { Viewport } from "./galaxyView";

/** The layer of lines drawn into the haze instead of the picture. */
export const HAZE_LAYER = 1;
/** The layer of the bodies that hide haze lines behind them. */
export const OCCLUDER_LAYER = 2;

/** The haze's size in pixels: half the drawing buffer in each direction. */
export function hazeSize(viewport: Viewport): [number, number] {
  return [
    Math.max(1, Math.round((viewport.width * viewport.pixelRatio) / 2)),
    Math.max(1, Math.round((viewport.height * viewport.pixelRatio) / 2)),
  ];
}

const COMPOSITE_VERTEX = /* glsl */ `
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const COMPOSITE_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D uHaze;
in vec2 vUv;
out vec4 outColor;
void main() {
  outColor = texture(uHaze, vUv);
}
`;

/**
 * Faint lines in great numbers, such as the orbits of Saturn's 280 small moons, drawn at half resolution
 * and without multisampling, and laid over the picture. Drawn into the picture, their pixels alone cost
 * almost two milliseconds per frame; here a sixteenth of the samples. The bodies are drawn into the
 * haze's depth first, so they still hide the lines behind them. Lines join with `HAZE_LAYER`, bodies
 * that hide them with `OCCLUDER_LAYER`.
 */
export class HazeLayer {
  private target: WebGLRenderTarget | null = null;
  private readonly depthOnly = new MeshBasicMaterial({ colorWrite: false });
  private readonly composite: Mesh<BufferGeometry, RawShaderMaterial>;
  private readonly overlay = new Scene();
  private readonly overlayCamera = new OrthographicCamera();
  private readonly clearColor = new Color();

  constructor() {
    // One triangle that covers the screen.
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.composite = new Mesh(
      geometry,
      new RawShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: COMPOSITE_VERTEX,
        fragmentShader: COMPOSITE_FRAGMENT,
        uniforms: { uHaze: { value: null } },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        // The haze holds colours already multiplied by their opacity.
        blending: CustomBlending,
        blendSrc: OneFactor,
        blendDst: OneMinusSrcAlphaFactor,
      }),
    );
    this.composite.frustumCulled = false;
    this.overlay.add(this.composite);
  }

  /** Draws the haze of `scene` and lays it over what has been drawn of it. */
  render(renderer: WebGLRenderer, scene: Scene, camera: Camera, viewport: Viewport): void {
    const [width, height] = hazeSize(viewport);
    if (!this.target) {
      // Half floats, as hundreds of lines of a few hundredths' opacity would round away in eight bits.
      this.target = new WebGLRenderTarget(width, height, { type: HalfFloatType, magFilter: LinearFilter, minFilter: LinearFilter });
      this.composite.material.uniforms.uHaze.value = this.target.texture;
    } else if (this.target.width !== width || this.target.height !== height) {
      this.target.setSize(width, height);
    }

    const autoClear = renderer.autoClear;
    const clearAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clearColor);
    const layers = camera.layers.mask;
    renderer.autoClear = false;

    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    camera.layers.set(OCCLUDER_LAYER);
    scene.overrideMaterial = this.depthOnly;
    renderer.render(scene, camera);
    scene.overrideMaterial = null;
    camera.layers.set(HAZE_LAYER);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(this.overlay, this.overlayCamera);

    camera.layers.mask = layers;
    renderer.setClearColor(this.clearColor, clearAlpha);
    renderer.autoClear = autoClear;
  }

  dispose(): void {
    this.target?.dispose();
    this.depthOnly.dispose();
    this.composite.geometry.dispose();
    this.composite.material.dispose();
  }
}
