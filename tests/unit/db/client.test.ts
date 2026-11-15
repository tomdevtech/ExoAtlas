import { describe, expect, it } from "vitest";
import { databaseUrl, poolOptions } from "@/db/client";

describe("databaseUrl", () => {
  const env = { DATABASE_URL: "postgres://owner@db/x", DATABASE_URL_READONLY: "postgres://reader@db/x" };

  it("reads through the read-only address inside the Next.js server", () => {
    expect(databaseUrl(env, true)).toBe("postgres://reader@db/x");
  });

  it("lets scripts and tests write through DATABASE_URL", () => {
    expect(databaseUrl(env, false)).toBe("postgres://owner@db/x");
  });

  it("falls back to DATABASE_URL when no read-only address is set", () => {
    expect(databaseUrl({ DATABASE_URL: "postgres://owner@db/x" }, true)).toBe("postgres://owner@db/x");
    expect(databaseUrl({ ...env, DATABASE_URL_READONLY: " " }, true)).toBe("postgres://owner@db/x");
  });

  it("has no address when DATABASE_URL is missing outside Next.js", () => {
    expect(databaseUrl({ DATABASE_URL_READONLY: "postgres://reader@db/x" }, false)).toBeUndefined();
    expect(databaseUrl({}, true)).toBeUndefined();
  });
});

describe("poolOptions", () => {
  it("keeps five connections with prepared statements by default", () => {
    expect(poolOptions({})).toEqual({ max: 5, prepare: true, idle_timeout: 20 });
  });

  it("takes the pool size from DATABASE_POOL_SIZE", () => {
    expect(poolOptions({ DATABASE_POOL_SIZE: "2" }).max).toBe(2);
  });

  it("ignores a pool size that is not a positive whole number", () => {
    for (const value of ["0", "-1", "1.5", "many", ""]) {
      expect(poolOptions({ DATABASE_POOL_SIZE: value }).max).toBe(5);
    }
  });

  it("turns prepared statements off only for DATABASE_PREPARE=false", () => {
    expect(poolOptions({ DATABASE_PREPARE: "false" }).prepare).toBe(false);
    expect(poolOptions({ DATABASE_PREPARE: " FALSE " }).prepare).toBe(false);
    expect(poolOptions({ DATABASE_PREPARE: "true" }).prepare).toBe(true);
    expect(poolOptions({ DATABASE_PREPARE: "no" }).prepare).toBe(true);
  });
});
