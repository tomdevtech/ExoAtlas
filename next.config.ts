import type { NextConfig } from "next";
import { securityHeaders } from "./src/shared/security-headers";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // The X-Powered-By header would only tell attackers which framework to target.
  poweredByHeader: false,
  async headers() {
    const development = process.env.NODE_ENV === "development";
    return [
      {
        source: "/:path*",
        headers: securityHeaders(development),
      },
      // Textures and shape grids are large and rarely change, but their file names are not hashed.
      // A day of caching plus a week of stale-while-revalidate avoids refetching on
      // every page. Development skips this so that regenerated files show at once.
      ...(development ? [] : ["/textures/:path*", "/shapes/:path*"]).map((source) => ({
        source,
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }],
      })),
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
