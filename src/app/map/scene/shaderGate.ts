import type { Camera, Material, Object3D, Scene, WebGLRenderer } from "three";

/**
 * Compiles shader programs in the background and skips objects whose program is not ready yet.
 * three.js otherwise compiles on first draw and waits for the driver, which on Windows can block the
 * page for up to a second. `compileAsync` uses KHR_parallel_shader_compile where the browser supports it.
 * Hidden objects are compiled too, so a planet waiting for its textures is ready when they arrive.
 */
export class ShaderGate {
  private readonly ready = new WeakSet<Material>();
  private readonly building = new WeakSet<Material>();

  /**
   * Renders the objects that are ready into the current render target and starts compiling the rest.
   * Returns true if nothing had to be skipped.
   */
  render(renderer: WebGLRenderer, scene: Scene, camera: Camera): boolean {
    const waiting: Object3D[] = [];
    let unbuilt = false;
    scene.traverse((object) => {
      const materials = materialsOf(object);
      if (materials.every((material) => this.ready.has(material))) return;
      if (object.visible) waiting.push(object);
      if (materials.some((material) => !this.building.has(material))) unbuilt = true;
    });
    if (unbuilt) this.build(renderer, scene, camera);
    for (const object of waiting) object.visible = false;
    renderer.render(scene, camera);
    for (const object of waiting) object.visible = true;
    return waiting.length === 0;
  }

  /** Starts compiling the programs that `scene` needs for the current render target, without drawing it. */
  prepare(renderer: WebGLRenderer, scene: Scene, camera: Camera): void {
    let unbuilt = false;
    scene.traverse((object) => {
      if (materialsOf(object).some((material) => !this.ready.has(material) && !this.building.has(material))) unbuilt = true;
    });
    if (unbuilt) this.build(renderer, scene, camera);
  }

  isReady(material: Material): boolean {
    return this.ready.has(material);
  }

  private build(renderer: WebGLRenderer, scene: Scene, camera: Camera): void {
    const materials: Material[] = [];
    const hidden: Object3D[] = [];
    scene.traverse((object) => {
      // three.js only compiles visible objects, so hidden ones are shown for the duration of the call.
      if (!object.visible) {
        hidden.push(object);
        object.visible = true;
      }
      for (const material of materialsOf(object)) {
        if (this.ready.has(material) || this.building.has(material)) continue;
        this.building.add(material);
        materials.push(material);
      }
    });
    let built: Promise<unknown>;
    try {
      // The type of the current render target is part of the program, so the caller must set it first.
      built = renderer.compileAsync(scene, camera);
    } finally {
      for (const object of hidden) object.visible = false;
    }
    const finish = () => {
      for (const material of materials) {
        this.building.delete(material);
        this.ready.add(material);
      }
    };
    // Failed builds are marked as ready too, so that three.js reports the error on first use as usual.
    built.then(finish, finish);
  }
}

function materialsOf(object: Object3D): Material[] {
  const material = (object as Object3D & { material?: Material | Material[] }).material;
  if (!material) return [];
  return Array.isArray(material) ? material : [material];
}
