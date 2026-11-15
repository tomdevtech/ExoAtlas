"use client";

import dynamic from "next/dynamic";

/**
 * The map only exists in the browser: it needs WebGL and the window. Loading
 * it on demand also keeps three.js out of every other page.
 */
const MilkyWayMap = dynamic(() => import("./MilkyWayMap"), {
  ssr: false,
  loading: () => (
    <p className="absolute inset-0 grid place-items-center text-sm text-muted">Loading the map…</p>
  ),
});

export function MapLoader() {
  return <MilkyWayMap />;
}
