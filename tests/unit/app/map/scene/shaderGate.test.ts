import { BufferGeometry, Group, Mesh, MeshBasicMaterial, Points, PointsMaterial, Scene, type Camera, type WebGLRenderer } from "three";
import { describe, expect, it } from "vitest";
import { ShaderGate } from "@/app/map/scene/shaderGate";

/**
 * A renderer that only notes what it was asked to do. A build ends when the
 * test says so, as the graphics driver ends it some frames later.
 */
function fakeRenderer() {
  const builds: { visible: string[]; finish: (ok: boolean) => void }[] = [];
  const pictures: string[][] = [];
  const names = (scene: Scene) => {
    const seen: string[] = [];
    scene.traverseVisible((object) => {
      if (object.name) seen.push(object.name);
    });
    return seen;
  };
  const renderer = {
    compileAsync(scene: Scene) {
      return new Promise<Scene>((resolve, reject) => {
        builds.push({ visible: names(scene), finish: (ok) => (ok ? resolve(scene) : reject(new Error("failed"))) });
      });
    },
    render(scene: Scene) {
      pictures.push(names(scene));
    },
  } as unknown as WebGLRenderer;
  return { renderer, builds, pictures };
}

const camera = {} as Camera;
/** Lets the promises that ended run their callbacks. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function thing(name: string) {
  const mesh = new Mesh(new BufferGeometry(), new MeshBasicMaterial());
  mesh.name = name;
  return mesh;
}

describe("ShaderGate", () => {
  it("draws nothing of what is still being built, and everything once it is built", async () => {
    const { renderer, builds, pictures } = fakeRenderer();
    const gate = new ShaderGate();
    const scene = new Scene().add(thing("sky"), thing("stars"));

    expect(gate.render(renderer, scene, camera)).toBe(false);
    expect(builds).toHaveLength(1);
    // The frame is drawn all the same, without the two.
    expect(pictures).toEqual([[]]);

    // Still building: no second build, still left out.
    expect(gate.render(renderer, scene, camera)).toBe(false);
    expect(builds).toHaveLength(1);

    builds[0].finish(true);
    await settle();
    expect(gate.render(renderer, scene, camera)).toBe(true);
    expect(pictures.at(-1)).toEqual(["sky", "stars"]);
    expect(builds).toHaveLength(1);
  });

  it("leaves everything as visible or hidden as it was", () => {
    const { renderer } = fakeRenderer();
    const gate = new ShaderGate();
    const shown = thing("shown");
    const hidden = thing("hidden");
    hidden.visible = false;
    gate.render(renderer, new Scene().add(shown, hidden), camera);
    expect(shown.visible).toBe(true);
    expect(hidden.visible).toBe(false);
  });

  it("builds what is hidden too, so a planet that waits for its maps is ready when they come", async () => {
    const { renderer, builds, pictures } = fakeRenderer();
    const gate = new ShaderGate();
    // A planet hangs on an anchor that stays hidden until its maps are there.
    const anchor = new Group();
    anchor.visible = false;
    const planet = thing("planet");
    anchor.add(planet);
    const scene = new Scene().add(anchor);

    gate.render(renderer, scene, camera);
    expect(builds[0].visible).toContain("planet");
    builds[0].finish(true);
    await settle();
    expect(gate.isReady(planet.material)).toBe(true);

    anchor.visible = true;
    expect(gate.render(renderer, scene, camera)).toBe(true);
    expect(pictures.at(-1)).toEqual(["planet"]);
  });

  it("builds what is added later on its own, while the rest goes on being drawn", async () => {
    const { renderer, builds, pictures } = fakeRenderer();
    const gate = new ShaderGate();
    const scene = new Scene().add(thing("sky"));
    gate.render(renderer, scene, camera);
    builds[0].finish(true);
    await settle();

    const stars = new Points(new BufferGeometry(), new PointsMaterial());
    stars.name = "stars";
    scene.add(stars);
    expect(gate.render(renderer, scene, camera)).toBe(false);
    expect(builds).toHaveLength(2);
    expect(pictures.at(-1)).toEqual(["sky"]);
    builds[1].finish(true);
    await settle();
    gate.render(renderer, scene, camera);
    expect(pictures.at(-1)).toEqual(["sky", "stars"]);
  });

  it("shares a program between the things that share a material", async () => {
    const { renderer, builds, pictures } = fakeRenderer();
    const gate = new ShaderGate();
    const material = new MeshBasicMaterial();
    const one = new Mesh(new BufferGeometry(), material);
    const two = new Mesh(new BufferGeometry(), material);
    one.name = "one";
    two.name = "two";
    const scene = new Scene().add(one, two);
    gate.render(renderer, scene, camera);
    expect(builds).toHaveLength(1);
    builds[0].finish(true);
    await settle();
    gate.render(renderer, scene, camera);
    expect(pictures.at(-1)).toEqual(["one", "two"]);
  });

  it("can build ahead of time without drawing, for what is to appear soon", async () => {
    const { renderer, builds, pictures } = fakeRenderer();
    const gate = new ShaderGate();
    const glow = thing("glow");
    const scene = new Scene().add(glow);
    gate.prepare(renderer, scene, camera);
    gate.prepare(renderer, scene, camera);
    expect(builds).toHaveLength(1);
    expect(pictures).toHaveLength(0);
    expect(gate.isReady(glow.material)).toBe(false);
    builds[0].finish(true);
    await settle();
    expect(gate.isReady(glow.material)).toBe(true);
    // Nothing is left to build.
    gate.prepare(renderer, scene, camera);
    expect(builds).toHaveLength(1);
  });

  it("lets a program through that fails to build, so three.js can report its error", async () => {
    const { renderer, builds, pictures } = fakeRenderer();
    const gate = new ShaderGate();
    const scene = new Scene().add(thing("broken"));
    gate.render(renderer, scene, camera);
    builds[0].finish(false);
    await settle();
    gate.render(renderer, scene, camera);
    expect(pictures.at(-1)).toEqual(["broken"]);
  });
});
