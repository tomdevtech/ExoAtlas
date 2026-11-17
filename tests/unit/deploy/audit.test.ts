import { describe, expect, it } from "vitest";
import { AUDIT_EXCEPTIONS, judgeAudit, seriousAdvisories, type AuditException, type AuditReport } from "@/deploy/audit";

/** A report in the format of `npm audit --json`, with picomatch rated high, vite affected through it and esbuild moderate. */
const report: AuditReport = {
  vulnerabilities: {
    picomatch: {
      name: "picomatch",
      via: [
        {
          name: "picomatch",
          title: "picomatch vulnerable to ReDoS through single-branch repeated extglobs",
          url: "https://github.com/advisories/GHSA-fc5q-39xc-vjpf",
          severity: "high",
        },
      ],
    },
    vite: { name: "vite", via: ["picomatch", "tinyglobby"] },
    tinyglobby: { name: "tinyglobby", via: ["picomatch"] },
    esbuild: {
      name: "esbuild",
      via: [{ name: "esbuild", title: "esbuild dev server", url: "https://github.com/advisories/GHSA-67mh-4wv8-2f99", severity: "moderate" }],
    },
  },
};

const picomatch: AuditException = { id: "GHSA-fc5q-39xc-vjpf", package: "picomatch", until: "2026-12-31", why: "no fix yet" };

describe("seriousAdvisories", () => {
  it("finds each advisory rated high or critical once, and not the moderate ones or the packages that only pass them on", () => {
    expect(seriousAdvisories(report)).toEqual([
      {
        id: "GHSA-fc5q-39xc-vjpf",
        package: "picomatch",
        title: "picomatch vulnerable to ReDoS through single-branch repeated extglobs",
        severity: "high",
      },
    ]);
    // The same advisory reached through two packages must be counted once.
    const twice: AuditReport = { vulnerabilities: { ...report.vulnerabilities, other: { name: "other", via: report.vulnerabilities.picomatch.via } } };
    expect(seriousAdvisories(twice)).toHaveLength(1);
    expect(seriousAdvisories({ vulnerabilities: {} })).toEqual([]);
  });

  it("counts critical advisories as well", () => {
    const critical: AuditReport = {
      vulnerabilities: { bad: { name: "bad", via: [{ name: "bad", title: "worse", url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc", severity: "critical" }] } },
    };
    expect(seriousAdvisories(critical).map((advisory) => advisory.id)).toEqual(["GHSA-aaaa-bbbb-cccc"]);
  });
});

describe("judgeAudit", () => {
  it("fails on a serious advisory that no exception accepts", () => {
    const { failures } = judgeAudit(report, [], "2026-11-17");
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("picomatch (high)");
    expect(failures[0]).toContain("https://github.com/advisories/GHSA-fc5q-39xc-vjpf");
  });

  it("lets an accepted advisory pass until its date, and fails again after it", () => {
    expect(judgeAudit(report, [picomatch], "2026-11-17").failures).toEqual([]);
    expect(judgeAudit(report, [picomatch], "2026-12-31").failures).toEqual([]);
    const late = judgeAudit(report, [picomatch], "2027-01-01");
    expect(late.failures).toHaveLength(1);
    expect(late.failures[0]).toContain("ran out on 2026-12-31");
  });

  it("says which advisories it accepted, and which exceptions are no longer needed", () => {
    expect(judgeAudit(report, [picomatch], "2026-11-17").notes).toEqual([
      expect.stringContaining("Accepted until 2026-12-31: picomatch (high)"),
    ]);
    const clean = judgeAudit({ vulnerabilities: {} }, [picomatch], "2026-11-17");
    expect(clean.failures).toEqual([]);
    expect(clean.notes).toEqual([expect.stringContaining("GHSA-fc5q-39xc-vjpf (picomatch) is no longer needed")]);
  });

  it("accepts an advisory only by its own id, not by the package", () => {
    const another: AuditReport = {
      vulnerabilities: {
        picomatch: { name: "picomatch", via: [{ name: "picomatch", title: "another flaw", url: "https://github.com/advisories/GHSA-zzzz-yyyy-xxxx", severity: "high" }] },
      },
    };
    expect(judgeAudit(another, [picomatch], "2026-11-17").failures).toHaveLength(1);
  });
});

describe("the exceptions", () => {
  it("each say why, until when, and run out within three months of being written", () => {
    for (const exception of AUDIT_EXCEPTIONS) {
      expect(exception.id).toMatch(/^GHSA(-[a-z0-9]{4}){3}$/);
      expect(exception.until).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(exception.why.length).toBeGreaterThan(40);
      // An exception only postpones a fix, so its expiry date must be near.
      expect(exception.until <= "2027-02-17").toBe(true);
    }
  });
});
