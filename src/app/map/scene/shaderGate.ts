import type { Camera, Material, Object3D, Scene, WebGLRenderer } from "three";

/**
 * Lets the map go on drawing while the graphics driver builds its shaders.
 *
 * three.js builds the program of a material the first time something is
 * drawn with it, and then waits for the driver. On Windows the driver takes
 * up to a second for the planets of a system, and the page stands still
 * meanwhile. Through this gate a program is built in the background first
 * (`compileAsync`, which uses KHR_parallel_shader_compile where the browser
 * has it), and what still waits for its program is left out of the picture
 * until it is ready, a few frames later.
 *
 * Things that are hidden are built too, so a planet that waits for its maps
 * has its program ready when they arrive.
 */
export class ShaderGate {
  private readonly ready = new WeakSet<Material>();
  private readonly building = new WeakSet<Material>();

  /**
   * Draws `scene` into the current render target with what is ready, and
   * starts building the rest. Returns whether everything could be drawn.
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

  /**
   * Starts building what `scene` needs without drawing it, for something
   * that is to appear soon. Uses the current render target, as `render` does.
   */
  prepare(renderer: WebGLRenderer, scene: Scene, camera: Camera): void {
    let unbuilt = false;
    scene.traverse((object) => {
      if (materialsOf(object).some((material) => !this.ready.has(material) && !this.building.has(material))) unbuilt = true;
    });
    if (unbuilt) this.build(renderer, scene, camera);
  }

  /** Whether the program of a material is built. */
  isReady(material: Material): boolean {
    return this.ready.has(material);
  }

  private build(renderer: WebGLRenderer, scene: Scene, camera: Camera): void {
    const materials: Material[] = [];
    const hidden: Object3D[] = [];
    scene.traverse((object) => {
      // three.js only builds what is visible.
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
      // Starts the builds at once, in the render target that is current, whose
      // kind is part of the program; the promise ends when they are done.
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
    // A program that fails to build is let through as well: three.js then
    // reports its error on first use, as it did without the gate.
    built.then(finish, finish);
  }
}

function materialsOf(object: Object3D): Material[] {
  const material = (object as Object3D & { material?: Material | Material[] }).material;
  if (!material) return [];
  return Array.isArray(material) ? material : [material];
}
