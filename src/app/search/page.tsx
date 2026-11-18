import type { Metadata } from "next";
import { Suspense } from "react";
import { PlanetCard } from "@/app/planets/PlanetCard";
import { BodyCard } from "@/app/solar-system/BodyCard";
import { StarCard } from "@/app/stars/StarCard";
import { MIN_QUERY_LENGTH, search } from "./query";

const RESULT_LIMIT = 60;

export const metadata: Metadata = {
  title: "Search",
  description: "Search all known exoplanets, their host stars and the moons and dwarf planets of the solar system by name.",
};

type Props = PageProps<"/search">;

export default function SearchPage({ searchParams }: Props) {
  // The page shell is static. The query in the URL is only known at request time, so everything that
  // depends on it streams in.
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Search</h1>
      <Suspense fallback={<ResultsSkeleton />}>
        <Results searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Results({ searchParams }: { searchParams: Props["searchParams"] }) {
  const { q } = await searchParams;
  const query = (Array.isArray(q) ? q[0] : q)?.trim() ?? "";

  if (query === "") {
    return <p className="text-muted">Type the name of a planet, a moon or a star into the search field.</p>;
  }

  const { hits, similarOnly, hasMore } = await search(query, RESULT_LIMIT);

  if (hits.length === 0) {
    return (
      <p className="text-muted">
        No planet or star matches “{query}”.
        {query.length < MIN_QUERY_LENGTH
          ? ` Type at least ${MIN_QUERY_LENGTH} characters.`
          : " Try a shorter part of the name, for example “Kepler-22” or “TRAPPIST”."}
      </p>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <p className="text-muted">
        {similarOnly
          ? `No name contains “${query}”. These names are similar:`
          : hasMore
            ? `The first ${hits.length} matches for “${query}”. Type more of the name to narrow it down.`
            : `${hits.length === 1 ? "1 match" : `${hits.length} matches`} for “${query}”.`}
      </p>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {hits.map((hit) =>
          hit.kind === "planet" ? (
            <li key={`planet-${hit.planet.slug}`}>
              <PlanetCard planet={hit.planet} showStar />
            </li>
          ) : hit.kind === "body" ? (
            <li key={`body-${hit.body.slug}`}>
              <BodyCard body={hit.body} showParent />
            </li>
          ) : (
            <li key={`star-${hit.star.slug}`}>
              <StarCard star={hit.star} />
            </li>
          ),
        )}
      </ul>
    </section>
  );
}

function ResultsSkeleton() {
  return (
    <div
      className="grid animate-pulse grid-cols-1 gap-3 sm:grid-cols-2"
      aria-busy="true"
      aria-label="Searching"
    >
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="h-20 rounded-lg bg-surface" />
      ))}
    </div>
  );
}
