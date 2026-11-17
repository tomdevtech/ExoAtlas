import {
  BackSide,
  GLSL3,
  Mesh,
  RawShaderMaterial,
  SphereGeometry,
  type Matrix3,
  type Texture,
} from "three";
import { SKY_FRAGMENT, SKY_VERTEX } from "./shaders";

export interface Sky {
  mesh: Mesh;
  setOpacity(opacity: number): void;
  dispose(): void;
}

/**
 * Creates the background sphere that shows the all-sky Milky Way photograph (ESO/S. Brunier).
 * `toGalactic` rotates scene directions into galactic coordinates so that the band lies where it belongs.
 */
export function createSky(texture: Texture, toGalactic: Matrix3): Sky {
  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    uniforms: {
      uMap: { value: texture },
      uOpacity: { value: 1 },
      uToGalactic: { value: toGalactic },
    },
    side: BackSide,
    depthTest: false,
    depthWrite: false,
  });
  const geometry = new SphereGeometry(1, 48, 24);
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return {
    mesh,
    setOpacity(opacity) {
      material.uniforms.uOpacity.value = opacity;
      mesh.visible = opacity > 0.002;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
