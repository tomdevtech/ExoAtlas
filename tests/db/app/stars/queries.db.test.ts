import { describe, expect, it } from "vitest";
import { findStarSlugByAlias, getStar, getStarFormerNames } from "@/app/stars/queries";

describe("star queries", () => {
  it("reads a star with its number of active planets", async () => {
    const star = await getStar("trappist-1");
    expect(star?.name).toBe("TRAPPIST-1");
    expect(star?.planetCount).toBe(7);
    expect(star?.source).toBe("nasa");
  });

  it("does not count withdrawn planets", async () => {
    expect((await getStar("retracted-1"))?.planetCount).toBe(0);
  });

  it("keeps the Sun as part of the solar system", async () => {
    const sun = await getStar("sun");
    expect(sun?.source).toBe("sol");
    expect(sun?.planetCount).toBe(8);
  });

  it("answers null for unknown or odd slugs", async () => {
    for (const slug of ["nope", "", "..%2F..%2Fetc", "sun'--", "SUN"]) {
      expect(await getStar(slug), slug).toBeNull();
    }
  });

  it("finds the current slug from a former one", async () => {
    expect(await findStarSlugByAlias("2mass-j23062928-0502285")).toBe("trappist-1");
    expect(await findStarSlugByAlias("trappist-1")).toBeNull();
    const star = await getStar("trappist-1");
    expect(await getStarFormerNames(star!.id)).toEqual(["2MASS J23062928-0502285"]);
  });
});
