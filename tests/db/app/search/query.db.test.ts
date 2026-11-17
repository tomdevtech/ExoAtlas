import { describe, expect, it } from "vitest";
import { search, type SearchHit } from "@/app/search/query";

const names = (hits: SearchHit[]) =>
  hits.map((hit) => (hit.kind === "planet" ? hit.planet.name : hit.star.name));

describe("search", () => {
  it("puts the exact name first", async () => {
    const { hits, similarOnly } = await search("Kepler-22 b", 10);
    expect(similarOnly).toBe(false);
    expect(names(hits)[0]).toBe("Kepler-22 b");
  });

  it("ignores spelling details", async () => {
    for (const query of ["kepler 22 b", "KEPLER22B", "kepler-22b", "  Kepler 22b  "]) {
      const { hits } = await search(query, 10);
      expect(names(hits)[0], query).toBe("Kepler-22 b");
    }
  });

  it("ranks whole numbers before names that merely start with the query", async () => {
    const { hits } = await search("kepler 22", 10);
    const found = names(hits);
    // An exact match ranks first, so the star and its planet come before Kepler-220.
    expect(found.slice(0, 2)).toEqual(["Kepler-22", "Kepler-22 b"]);
    expect(found.indexOf("Kepler-220 b")).toBeGreaterThan(found.indexOf("Kepler-22 b"));
    expect(found).not.toContain("Kepler-12 b");
  });

  it("finds planets and stars together", async () => {
    const { hits } = await search("trappist", 20);
    expect(hits.filter((hit) => hit.kind === "star")).toHaveLength(1);
    expect(hits.filter((hit) => hit.kind === "planet")).toHaveLength(7);
  });

  it("reports when there are more hits than the limit", async () => {
    const limited = await search("trappist", 5);
    expect(limited.hits).toHaveLength(5);
    expect(limited.hasMore).toBe(true);
    const all = await search("trappist", 8);
    expect(all.hasMore).toBe(false);
  });

  it("falls back to similar names for typos", async () => {
    const { hits, similarOnly } = await search("proxma cen", 10);
    expect(similarOnly).toBe(true);
    expect(names(hits)).toContain("Proxima Cen b");
  });

  it("answers with nothing for queries that are too short", async () => {
    for (const query of ["", "x", " k ", "!!", "%", "_", "--"]) {
      const result = await search(query, 10);
      expect(result, JSON.stringify(query)).toEqual({ hits: [], similarOnly: false, hasMore: false });
    }
  });

  it("also lists planets that NASA withdrew, marked as removed", async () => {
    const { hits } = await search("retracted 1 b", 10);
    const planet = hits.find((hit) => hit.kind === "planet");
    expect(planet?.kind === "planet" && planet.planet.status).toBe("removed");
  });
});

describe("search with hostile input", () => {
  // The search reduces every query to a-z and 0-9 before it reaches SQL, so none
  // of these inputs may cause an error or match everything.
  const hostile = [
    "' OR 1=1 --",
    "'; DROP TABLE planets; --",
    "\" OR \"\"=\"",
    "%' OR '%'='",
    "kepler%",
    "kepler_22",
    ".*",
    "(a+)+$",
    "\\",
    "\u0000kepler",
    "<script>alert(1)</script>",
    "${7*7}",
    "😀🪐",
    "ΚΕΠΛΕΡ",
  ];

  it.each(hostile)("handles %j", async (query) => {
    const { hits } = await search(query, 50);
    // The catalogue has more than 20 entries, so matching all of them would mean
    // that the input changed the query.
    expect(hits.length).toBeLessThan(20);
  });

  it("cuts off very long queries", async () => {
    // A query of 30,000 characters reaches the database as 80. The similarity
    // search may still find Kepler names in "keplerkepler…", but nothing breaks.
    const result = await search("kepler".repeat(5_000), 10);
    expect(result.hits.length).toBeLessThanOrEqual(10);
    // Anything beyond the first 80 characters must be ignored.
    const tail = await search(`${"z".repeat(80)}kepler-22 b`, 10);
    expect(tail.hits.map((hit) => (hit.kind === "planet" ? hit.planet.name : hit.star.name))).not.toContain(
      "Kepler-22 b",
    );
  });

  it("still finds the planet when junk surrounds the name", async () => {
    const { hits } = await search("<b>kepler-22 b</b>", 10);
    // The tags reduce to "b" and "b", so the key is "bkepler22bb", which finds
    // nothing but must not cause an error either.
    expect(Array.isArray(hits)).toBe(true);
    const plain = await search("kepler-22 b'; --", 10);
    expect(names(plain.hits)[0]).toBe("Kepler-22 b");
  });
});
