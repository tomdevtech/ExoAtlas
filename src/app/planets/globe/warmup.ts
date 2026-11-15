import { GlobeRenderer } from "./renderer";
import { ALL_SURFACE_DEFINES } from "./uniforms";

/** How often to look whether the programs are done. */
const POLL_MS = 250;

let started = false;

/**
 * Builds every planet program once in a hidden canvas, so that a planet page
 * opened later finds its shader ready.
 *
 * The browser keeps built programs in memory while it runs and reuses them
 * for every canvas with the same shader code. Without this, the first planet
 * page of a visit waits for its program to be built before the 3D model
 * appears. Runs once per visit.
 */
export function warmUpGlobes(): void {
  if (started) return;
  started = true;

  const canvas = document.createElement("canvas");
  // Sized before the context exists: a later resize would wait for the builds.
  canvas.width = 1;
  canvas.height = 1;
  const renderer = GlobeRenderer.create(canvas, "sm");
  if (!renderer) return;
  // Without background builds, waiting for the programs would freeze the page.
  if (!renderer.buildsInBackground) {
    renderer.dispose();
    return;
  }

  for (const defines of ALL_SURFACE_DEFINES) renderer.prepare(defines);
  const finish = () => {
    if (renderer.busy()) {
      setTimeout(finish, POLL_MS);
      return;
    }
    renderer.dispose();
    // Frees the context at once instead of waiting for the garbage collector.
    canvas.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
  };
  setTimeout(finish, POLL_MS);
}
