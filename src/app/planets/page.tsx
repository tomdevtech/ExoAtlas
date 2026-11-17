import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { planetAppearance } from "./appearance";
import {
  PAGE_SIZE,
  type ListSort,
  listHref,
  pageCount,
  pageLinks,
  parseFilter,
  parsePage,
  parseSort,
} from "./paging";
import { PlanetDot } from "./PlanetDot";
import { PlanetFilter } from "./PlanetFilter";
import { listPlanets } from "./queries";

export const metadata: Metadata = {
  title: "All planets",
  description:
    "Every known exoplanet and the planets of the solar system in one list, sorted by name or by year of discovery.",
};

type Props = PageProps<"/planets">;
type SearchParams = Props["searchParams"];

const numberFormat = new Intl.NumberFormat("en-US");

export default function PlanetListPage({ searchParams }: Props) {
  // The page shell is static. Filter, sort order and page come from the URL, which is only known at
  // request time, so the field and the list stream in. They suspend separately so the field keeps its
  // place while a new list loads.
  return (
    <main className="group mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">All planets</h1>
      <Suspense fallback={<PlanetFilter disabled />}>
        <Filter searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<ListSkeleton />}>
        <PlanetList searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Filter({ searchParams }: { searchParams: SearchParams }) {
  const { q, sort } = await searchParams;
  return <PlanetFilter initial={parseFilter(q)} sort={parseSort(sort)} />;
}

/** Column classes of a row. The header above the list uses the same widths. */
const STAR_COLUMN = "hidden w-52 shrink-0 truncate sm:block";
const YEAR_COLUMN = "w-20 shrink-0 text-right tabular-nums";

async function PlanetList({ searchParams }: { searchParams: SearchParams }) {
  const { q, page: pageParam, sort: sortParam } = await searchParams;
  const filter = parseFilter(q);
  const sort = parseSort(sortParam);
  const { planets, total, page } = await listPlanets(filter, parsePage(pageParam), sort);

  if (total === 0) {
    return (
      <p className="text-muted">
        No planet matches “{filter}”. Try a shorter part of the name, for example “Kepler-22” or
        “TRAPPIST”.
      </p>
    );
  }

  const first = (page - 1) * PAGE_SIZE + 1;
  const last = first + planets.length - 1;
  const pages = pageCount(total);
  const count = `${numberFormat.format(total)} ${total === 1 ? "planet" : "planets"}`;

  return (
    // The list dims while the filter field waits for the server (PlanetFilter sets data-pending).
    <section className="flex flex-col gap-5 transition-opacity group-has-[[data-pending]]:opacity-50">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <p className="text-sm text-muted">
          {filter === "" ? count : `${count} match “${filter}”`}
          {pages > 1 && ` · showing ${numberFormat.format(first)}–${numberFormat.format(last)}`}
        </p>
        <SortSwitch filter={filter} sort={sort} />
      </div>

      <Pager filter={filter} sort={sort} page={page} pages={pages} label="Pages, top" />

      <div>
        <div className="flex items-center gap-3 border-b border-line pb-2 text-xs tracking-wide text-muted uppercase">
          {/* This spacer is as wide as the image, so "Planet" lines up with the names. */}
          <span className="w-7 shrink-0" />
          <span className="min-w-0 flex-1">Planet</span>
          <span className={STAR_COLUMN}>Star</span>
          <span className={YEAR_COLUMN}>Discovered</span>
        </div>
        <ul>
          {planets.map((planet) => (
            <li key={planet.slug} className="border-b border-line/50">
              {/* With 200 links per page, prefetching is off so no link loads its target before a click. */}
              <Link
                href={`/planets/${planet.slug}`}
                prefetch={false}
                className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-surface"
              >
                <PlanetDot appearance={planetAppearance(planet)} />
                <span className="min-w-0 flex-1 truncate">{planet.name}</span>
                <span className={`${STAR_COLUMN} text-sm text-muted`}>{planet.starName}</span>
                <span className={`${YEAR_COLUMN} text-sm text-muted`}>
                  {planet.discoveryYear ?? <span title="Known since antiquity">–</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex justify-center">
        <Pager filter={filter} sort={sort} page={page} pages={pages} label="Pages, bottom" />
      </div>
    </section>
  );
}

const SORTS: { sort: ListSort; label: string }[] = [
  { sort: "name", label: "Name" },
  { sort: "discovery", label: "Discovery year" },
];

/** Switches between sorting by name and by discovery year, newest first. A new order starts on page 1 and keeps the filter. */
function SortSwitch({ filter, sort }: { filter: string; sort: ListSort }) {
  return (
    <nav aria-label="Sort order" className="flex items-center gap-2 text-sm">
      <span className="text-muted">Sort by</span>
      <div className="flex rounded-md border border-line p-0.5">
        {SORTS.map((option) =>
          option.sort === sort ? (
            <span
              key={option.sort}
              aria-current="true"
              className="rounded bg-surface px-2.5 py-1 font-medium text-foreground"
            >
              {option.label}
            </span>
          ) : (
            <Link
              key={option.sort}
              href={listHref(filter, 1, option.sort)}
              prefetch={false}
              scroll={false}
              className="rounded px-2.5 py-1 text-muted transition-colors hover:text-foreground"
            >
              {option.label}
            </Link>
          ),
        )}
      </div>
    </nav>
  );
}

const PAGER_ITEM = "flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm";
const PAGER_LINK = `${PAGER_ITEM} border border-line text-muted transition-colors hover:border-accent/60 hover:text-foreground`;

/** Previous and next links with the page numbers in between. Renders nothing when everything fits on one page. */
function Pager({
  filter,
  sort,
  page,
  pages,
  label,
}: {
  filter: string;
  sort: ListSort;
  page: number;
  pages: number;
  label: string;
}) {
  if (pages <= 1) return null;

  const step = (target: number, text: string, name: string) =>
    target >= 1 && target <= pages ? (
      <Link
        href={listHref(filter, target, sort)}
        prefetch={false}
        aria-label={name}
        className={PAGER_LINK}
      >
        {text}
      </Link>
    ) : (
      <span aria-hidden className={`${PAGER_ITEM} border border-line/50 text-muted/40`}>
        {text}
      </span>
    );

  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-1.5">
      {step(page - 1, "‹", "Previous page")}
      {pageLinks(page, pages).map((link, index) =>
        link === "gap" ? (
          <span key={`gap-${index}`} aria-hidden className="px-0.5 text-sm text-muted">
            …
          </span>
        ) : link === page ? (
          <span
            key={link}
            aria-current="page"
            className={`${PAGER_ITEM} border border-accent/60 bg-surface font-medium text-foreground`}
          >
            {link}
          </span>
        ) : (
          <Link
            key={link}
            href={listHref(filter, link, sort)}
            prefetch={false}
            aria-label={`Page ${link}`}
            className={PAGER_LINK}
          >
            {link}
          </Link>
        ),
      )}
      {step(page + 1, "›", "Next page")}
    </nav>
  );
}

function ListSkeleton() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading the list">
      {Array.from({ length: 24 }, (_, index) => (
        <div key={index} className="flex items-center gap-3 border-b border-line/50 py-2">
          <div className="size-7 shrink-0 rounded-full bg-surface" />
          <div className="h-4 w-1/3 rounded bg-surface" />
        </div>
      ))}
    </div>
  );
}
