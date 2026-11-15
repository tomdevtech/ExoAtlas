import Link from "next/link";
import { planetAppearance } from "./appearance";
import { describePlanet } from "./labels";
import { PlanetImage } from "./PlanetImage";
import type { PlanetSummary } from "./queries";

/** A planet as a list entry: small image, name and a one-line description. Links to its page. */
export function PlanetCard({
  planet,
  showStar = false,
}: {
  planet: PlanetSummary;
  /** Adds the name of the host star, for lists that mix several systems. */
  showStar?: boolean;
}) {
  const description = describePlanet(planet.planetClass, planet.climateClass);
  return (
    <Link
      href={`/planets/${planet.slug}`}
      className="flex items-center gap-4 rounded-lg border border-line p-3 transition-colors hover:border-accent/60 hover:bg-surface"
    >
      <PlanetImage appearance={planetAppearance(planet)} size={56} className="shrink-0" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{planet.name}</span>
        <span className="truncate text-sm text-muted">
          {description}
          {showStar && ` · ${planet.starName}`}
          {planet.status === "removed" && " · no longer listed"}
        </span>
      </span>
    </Link>
  );
}
