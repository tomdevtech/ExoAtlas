import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, securityHeaders } from "./security-headers";

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split(";").map((part) => {
      const [name, ...sources] = part.trim().split(/\s+/);
      return [name, sources];
    }),
  );
}

describe("contentSecurityPolicy", () => {
  const production = directives(contentSecurityPolicy(false));

  it("only allows this site as a source by default", () => {
    expect(production.get("default-src")).toEqual(["'self'"]);
  });

  it("forbids frames, plugins and foreign form targets", () => {
    expect(production.get("frame-ancestors")).toEqual(["'none'"]);
    expect(production.get("object-src")).toEqual(["'none'"]);
    expect(production.get("form-action")).toEqual(["'self'"]);
    expect(production.get("base-uri")).toEqual(["'self'"]);
  });

  it("allows no foreign hosts and no eval in production", () => {
    for (const [name, sources] of production) {
      for (const source of sources) {
        expect(source, `${name} ${source}`).toMatch(/^('self'|'none'|'unsafe-inline'|blob:|data:)$/);
      }
    }
    expect(production.get("script-src")).not.toContain("'unsafe-eval'");
  });

  it("allows eval and the reload socket only in development", () => {
    const dev = directives(contentSecurityPolicy(true));
    expect(dev.get("script-src")).toContain("'unsafe-eval'");
    expect(dev.get("connect-src")).toContain("ws:");
    expect(production.get("connect-src")).toEqual(["'self'"]);
  });

  it("is a single header line", () => {
    expect(contentSecurityPolicy(false)).not.toMatch(/[\r\n]/);
  });
});

describe("securityHeaders", () => {
  const headers = new Map(securityHeaders(false).map((h) => [h.key, h.value]));

  it("sets the usual protective headers", () => {
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(headers.get("Strict-Transport-Security")).toMatch(/max-age=\d{8,}/);
  });

  it("turns off camera, microphone and location, but not fullscreen", () => {
    const policy = headers.get("Permissions-Policy") ?? "";
    for (const feature of ["camera", "microphone", "geolocation"]) {
      expect(policy).toContain(`${feature}=()`);
    }
    expect(policy).not.toContain("fullscreen");
  });

  it("names every header only once", () => {
    const keys = securityHeaders(false).map((h) => h.key.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
  });
});
