import type { Metadata } from "next";
import { MapLoader } from "./MapLoader";

export const metadata: Metadata = {
  title: "Map",
  description:
    "Fly through the Milky Way: every star with known planets at its real position, and each system with its planets in 3D.",
};

/**
 * The frame of the map. It is static; the map itself starts in the browser
 * and fetches its data from /map/stars and /map/systems/[slug].
 */
export default function MapPage() {
  return (
    <main data-map className="relative min-h-0 flex-1 overflow-hidden bg-black">
      <h1 className="sr-only">Map of the Milky Way</h1>
      <MapLoader />
      <noscript>
        <p className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted">
          The map needs JavaScript. Every star and planet also has its own page.
        </p>
      </noscript>
    </main>
  );
}
