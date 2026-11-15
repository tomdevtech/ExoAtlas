/** Lower case without accents: "Proxima Centauri" and "Próxima Centauri" fold to the same text. */
function fold(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** URL part from a name: "Kepler-22 b" becomes `kepler-22-b`. */
export function slugify(name: string): string {
  return fold(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Whether `value` can be a slug at all. Addresses come from outside: anything
 * else (a null byte, a slash, 5,000 characters) is answered as "not found"
 * without asking the database, which would reject some of it with an error.
 */
export function isSlug(value: string): boolean {
  return value.length <= 200 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

/**
 * Search key without spaces or punctuation: "Kepler-22 b", "kepler 22b" and
 * "Kepler22b" all become `kepler22b`.
 */
export function searchKey(name: string): string {
  return fold(name).replace(/[^a-z0-9]+/g, "");
}

/** Appends -2, -3 … until the slug is free, then reserves it in `taken`. */
export function uniqueSlug(name: string, taken: Set<string>): string {
  const base = slugify(name) || "unnamed";
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  taken.add(slug);
  return slug;
}
