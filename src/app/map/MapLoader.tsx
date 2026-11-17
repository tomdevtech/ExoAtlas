"use client";

import dynamic from "next/dynamic";

/**
 * The map is client-only because it needs WebGL and `window`. Loading it on demand
 * also keeps three.js out of the bundles of all other pages.
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
