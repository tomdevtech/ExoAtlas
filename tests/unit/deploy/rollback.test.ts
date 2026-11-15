import { describe, expect, it } from "vitest";
import { deploymentHost, pickRollbackTarget } from "@/deploy/rollback";

const listed = (url: string, createdAt: number, extra: Record<string, unknown> = {}) => ({
  url,
  createdAt,
  target: "production",
  state: "READY",
  ...extra,
});

describe("deploymentHost", () => {
  it("reduces an address to its host name", () => {
    expect(deploymentHost("https://Exoatlas-ABC.vercel.app/")).toBe("exoatlas-abc.vercel.app");
    expect(deploymentHost("exoatlas-abc.vercel.app")).toBe("exoatlas-abc.vercel.app");
    expect(deploymentHost(" https://exoatlas-abc.vercel.app/health ")).toBe("exoatlas-abc.vercel.app");
  });
});

describe("pickRollbackTarget", () => {
  const failed = "https://exoatlas-new.vercel.app";

  it("picks the newest production deployment before the failed one", () => {
    const output = {
      deployments: [
        listed("exoatlas-new.vercel.app", 300),
        listed("exoatlas-good.vercel.app", 200),
        listed("exoatlas-old.vercel.app", 100),
      ],
    };
    expect(pickRollbackTarget(output, failed)).toBe("exoatlas-good.vercel.app");
  });

  it("does not depend on the order of the list", () => {
    const output = [listed("exoatlas-old.vercel.app", 100), listed("exoatlas-good.vercel.app", 200), listed("exoatlas-new.vercel.app", 300)];
    expect(pickRollbackTarget(output, failed)).toBe("exoatlas-good.vercel.app");
  });

  it("skips deployments that are not ready or not production", () => {
    const output = [
      listed("exoatlas-new.vercel.app", 300),
      listed("exoatlas-broken.vercel.app", 250, { state: "ERROR" }),
      listed("exoatlas-preview.vercel.app", 240, { target: null }),
      listed("exoatlas-good.vercel.app", 200),
    ];
    expect(pickRollbackTarget(output, failed)).toBe("exoatlas-good.vercel.app");
  });

  it("also reads the older field names", () => {
    const output = [{ url: "exoatlas-good.vercel.app", created: 200, readyState: "READY" }];
    expect(pickRollbackTarget(output, failed)).toBe("exoatlas-good.vercel.app");
  });

  it("answers null when the failed deployment is the only one", () => {
    expect(pickRollbackTarget([listed("exoatlas-new.vercel.app", 300)], failed)).toBeNull();
    expect(pickRollbackTarget({ deployments: [] }, failed)).toBeNull();
  });

  it("throws on output it does not understand", () => {
    expect(() => pickRollbackTarget("nonsense", failed)).toThrow(/did not list/);
    expect(() => pickRollbackTarget({ error: "forbidden" }, failed)).toThrow(/did not list/);
  });
});
