import Link from "next/link";
import { PlanetImage } from "@/app/planets/PlanetImage";
import { formatNumber } from "@/shared/format";
import { bodyAppearance, describeBody, type SolarBody } from "./bodies";

/** A moon or dwarf planet as a list entry: small image, name and what it orbits. Links to its page. */
export function BodyCard({ body, showParent = false }: { body: SolarBody; showParent?: boolean }) {
  return (
    <Link
      href={`/solar-system/${body.slug}`}
      className="flex items-center gap-4 rounded-lg border border-line p-3 transition-colors hover:border-accent/60 hover:bg-surface"
    >
      <PlanetImage appearance={bodyAppearance(body)} size={56} className="shrink-0" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{body.name}</span>
        <span className="truncate text-sm text-muted">
          {showParent ? describeBody(body) : `${formatNumber(body.radiusKm * 2)} km across`}
        </span>
      </span>
    </Link>
  );
}
