import { Texture, Vector3 } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GALACTIC_CENTRE } from "@/app/map/galaxy";
import { GalaxyView, type Viewport } from "@/app/map/scene/galaxyView";

/**
 * How the camera of the galaxy moves. The view is built without a browser:
 * the picture of the galaxy cannot be fetched here, so the galaxy stays
 * without its stars and clouds, which the camera does not need.
 */

const viewport: Viewport = { width: 1280, height: 720, pixelRatio: 1 };
const centre = new Vector3(...GALACTIC_CENTRE);
const keys = new Set<string>();

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 })));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function view(): GalaxyView {
  return new GalaxyView(new Texture(), "/textures/sky/galaxy.jpg");
}

/** Lets the camera run for some frames of a sixtieth of a second. */
function run(galaxy: GalaxyView, frames: number, held = keys): void {
  for (let frame = 0; frame < frames; frame++) galaxy.update(1 / 60, held, viewport);
}

describe("the camera circling the centre of the galaxy", () => {
  it("starts with the whole galaxy and says so", () => {
    const galaxy = view();
    const told = vi.fn();
    galaxy.onOrbitChange = told;
    expect(galaxy.orbiting).toBe(false);
    galaxy.flyToOverview(true);
    expect(galaxy.orbiting).toBe(true);
    expect(told).toHaveBeenLastCalledWith(true);
    // Flying home lets it fly freely again.
    galaxy.flyHome(true);
    expect(galaxy.orbiting).toBe(false);
    expect(told).toHaveBeenLastCalledWith(false);
  });

  it("rests exactly where it is when nothing moves it, wherever it was turned to", () => {
    // Worked out again from itself each frame, the place moved by a rounding
    // error now and then, and the whole galaxy was drawn again for nothing.
    const galaxy = view();
    galaxy.flyToOverview(true);
    run(galaxy, 5);
    // The rounding error only struck at a few places in a hundred, so many are tried.
    for (let turn = 0; turn < 400; turn++) {
      galaxy.drag(97 * Math.sin(turn * 12.9898), 61 * Math.sin(turn * 78.233));
      run(galaxy, 2);
      const resting = galaxy.camera.position.clone();
      run(galaxy, 30);
      expect(galaxy.camera.position.equals(resting), `after turn ${turn}`).toBe(true);
    }
  });

  it("turns round the centre and keeps looking at it", () => {
    const galaxy = view();
    galaxy.flyToOverview(true);
    run(galaxy, 5);
    const before = galaxy.camera.position.clone();
    const distance = before.distanceTo(centre);
    galaxy.drag(200, 0);
    run(galaxy, 2);
    const after = galaxy.camera.position.clone();
    expect(after.equals(before)).toBe(false);
    // On a sphere round the centre: the distance stays.
    expect(after.distanceTo(centre)).toBeCloseTo(distance, 3);
    // The centre stays in the middle of the view.
    const forward = new Vector3(0, 0, -1).applyQuaternion(galaxy.camera.quaternion);
    expect(forward.angleTo(centre.clone().sub(after))).toBeLessThan(1e-3);
  });

  it("comes nearer with the wheel and the W key, but not into the centre or far beyond the galaxy", () => {
    const galaxy = view();
    galaxy.flyToOverview(true);
    run(galaxy, 5);
    const start = galaxy.camera.position.distanceTo(centre);
    galaxy.push(3);
    run(galaxy, 60);
    const nearer = galaxy.camera.position.distanceTo(centre);
    expect(nearer).toBeLessThan(start);
    run(galaxy, 60 * 30, new Set(["KeyW"]));
    expect(galaxy.camera.position.distanceTo(centre)).toBeCloseTo(400, 0);
    run(galaxy, 60 * 60, new Set(["KeyS", "ShiftLeft"]));
    expect(galaxy.camera.position.distanceTo(centre)).toBeCloseTo(120_000, -2);
  });

  it("stops circling when asked, and flies freely again", () => {
    const galaxy = view();
    galaxy.setOrbit(true, true);
    expect(galaxy.orbiting).toBe(true);
    run(galaxy, 5);
    galaxy.setOrbit(false);
    expect(galaxy.orbiting).toBe(false);
    // Flying freely, W moves the camera forwards, away from where it was.
    const before = galaxy.camera.position.clone();
    run(galaxy, 30, new Set(["KeyW"]));
    expect(galaxy.camera.position.distanceTo(before)).toBeGreaterThan(0);
  });
});
