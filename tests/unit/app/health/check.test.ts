import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkHealth, currentCommit } from "@/app/health/check";

describe("checkHealth", () => {
  let log: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    log = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => log.mockRestore());

  it("reports ok when the database answers", async () => {
    const report = await checkHealth(async () => [{ "?column?": 1 }], { commit: "abc1234" });
    expect(report).toEqual({ status: "ok", database: "ok", commit: "abc1234" });
  });

  it("reports an error without details when the database fails", async () => {
    const secret = "password authentication failed for user exoatlas at db.internal";
    const report = await checkHealth(
      async () => {
        throw new Error(secret);
      },
      { commit: null },
    );
    expect(report).toEqual({ status: "error", database: "unreachable", commit: null });
    expect(JSON.stringify(report)).not.toContain("password");
    // The details go to the server log.
    expect(log).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ message: secret }));
  });

  it("gives up on a database that hangs", async () => {
    const start = Date.now();
    const report = await checkHealth(() => new Promise(() => {}), { timeoutMs: 50, commit: null });
    expect(report.status).toBe("error");
    expect(Date.now() - start).toBeLessThan(1_000);
  });
});

describe("currentCommit", () => {
  it("shortens the commit Vercel provides", () => {
    expect(currentCommit({ VERCEL_GIT_COMMIT_SHA: "0123456789abcdef" })).toBe("0123456");
  });

  it("is null outside Vercel", () => {
    expect(currentCommit({})).toBeNull();
    expect(currentCommit({ VERCEL_GIT_COMMIT_SHA: " " })).toBeNull();
  });
});
