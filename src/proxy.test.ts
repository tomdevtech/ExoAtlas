import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

const call = (path: string) => proxy(new NextRequest(`http://localhost${path}`));

describe("proxy", () => {
  it("answers 400 for broken percent-encoding", async () => {
    for (const path of ["/planets/%E0%A4%A", "/stars/%", "/map/systems/%ZZ"]) {
      const response = call(path);
      expect(response.status, path).toBe(400);
      expect(await response.text()).toMatch(/not encoded correctly/);
    }
  });

  it("lets every correct address through", () => {
    for (const path of ["/planets/kepler-22-b", "/stars/sun", "/map/systems/trappist-1", "/planets/caf%C3%A9"]) {
      // NextResponse.next() marks the response so Next.js carries on.
      expect(call(path).headers.get("x-middleware-next"), path).toBe("1");
    }
  });
});
