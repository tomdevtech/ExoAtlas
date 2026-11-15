/** How many planets one page of the list shows. */
export const PAGE_SIZE = 200;

/** The orders the list offers: by name, or by year of discovery with the newest first. */
export type ListSort = "name" | "discovery";

/** A value from the address, as Next.js hands it over. */
type Param = string | string[] | undefined;

function first(value: Param): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** The filter text from `?q=`, without spaces around it. */
export function parseFilter(value: Param): string {
  return first(value).trim();
}

/** The page number from `?page=`. Anything that is not a whole number from 1 up counts as page 1. */
export function parsePage(value: Param): number {
  const text = first(value).trim();
  if (!/^\d{1,9}$/.test(text)) return 1;
  return Math.max(1, Number(text));
}

/** The order from `?sort=`. Anything but `discovery` means by name. */
export function parseSort(value: Param): ListSort {
  return first(value).trim() === "discovery" ? "discovery" : "name";
}

/** Number of pages for `total` entries. An empty list still has one page. */
export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}

/** The nearest page that exists, so `?page=999` shows the last page instead of nothing. */
export function clampPage(page: number, total: number): number {
  return Math.min(Math.max(1, page), pageCount(total));
}

/**
 * Address of a page of the list. Page 1, an empty filter and the order by
 * name are left out, so `/planets` stays short.
 */
export function listHref(filter: string, page = 1, sort: ListSort = "name"): string {
  const params = new URLSearchParams();
  if (filter !== "") params.set("q", filter);
  if (sort !== "name") params.set("sort", sort);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query === "" ? "/planets" : `/planets?${query}`;
}

/**
 * The page numbers the pager shows: the first, the last and the ones around
 * the current page. "gap" stands for the numbers left out in between.
 *
 * Page 5 of 33 gives 1, gap, 4, 5, 6, gap, 33.
 */
export function pageLinks(current: number, count: number): (number | "gap")[] {
  const shown = new Set([1, count, current - 1, current, current + 1]);
  // A gap that would hide a single number shows that number instead.
  if (current - 2 === 2) shown.add(2);
  if (current + 2 === count - 1) shown.add(count - 1);

  const pages = [...shown].filter((page) => page >= 1 && page <= count).sort((a, b) => a - b);
  const links: (number | "gap")[] = [];
  for (const page of pages) {
    const previous = links.at(-1);
    if (typeof previous === "number" && page - previous > 1) links.push("gap");
    links.push(page);
  }
  return links;
}
