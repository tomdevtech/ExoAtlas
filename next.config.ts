import type { NextConfig } from "next";
import { securityHeaders } from "./src/shared/security-headers";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // No "X-Powered-By: Next.js": it only tells attackers what to look for.
  poweredByHeader: false,
  async headers() {
    const development = process.env.NODE_ENV === "development";
    return [
      {
        source: "/:path*",
        headers: securityHeaders(development),
      },
      // The maps of the planets and the sky are large and change rarely, but
      // their names stay the same when they do. So a browser may keep them for
      // a day, and for a week more show its copy while it fetches a new one.
      // Without this it would ask again on every page. Not in development,
      // where a map made anew should show at once.
      ...(development
        ? []
        : [
            {
              source: "/textures/:path*",
              headers: [
                {
                  key: "Cache-Control",
                  value: "public, max-age=86400, stale-while-revalidate=604800",
                },
              ],
            },
          ]),
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
