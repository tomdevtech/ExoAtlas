import Link from "next/link";
import { StarImage } from "./StarImage";

/** The star fields a list entry needs. */
export interface StarSummary {
  slug: string;
  name: string;
  teffK: number | null;
  planetCount: number;
}

/** Describes a star by its planet count, for example "Star · 3 known planets". */
export function describeStar(planetCount: number): string {
  return planetCount === 1 ? "Star · 1 known planet" : `Star · ${planetCount} known planets`;
}

/** A star as a list entry that links to its page. */
export function StarCard({ star }: { star: StarSummary }) {
  return (
    <Link
      href={`/stars/${star.slug}`}
      className="flex items-center gap-4 rounded-lg border border-line p-3 transition-colors hover:border-accent/60 hover:bg-surface"
    >
      <StarImage teffK={star.teffK} size={56} className="shrink-0" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{star.name}</span>
        <span className="truncate text-sm text-muted">{describeStar(star.planetCount)}</span>
      </span>
    </Link>
  );
}
