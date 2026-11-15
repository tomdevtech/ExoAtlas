/**
 * HTTP headers that every answer carries. next.config.ts sets them, the tests
 * in security-headers.test.ts and e2e/security.spec.ts check them.
 *
 * The Content Security Policy only lets the browser load scripts, styles,
 * images, fonts and data from this site, and forbids other sites to show
 * ExoAtlas in a frame. Next.js puts small inline scripts into every page that
 * carry the data of the page, so scripts need 'unsafe-inline'. A policy with
 * nonces would avoid that, but would force every page to be rendered on each
 * request and lose the prerendered frames (see the Next.js guide
 * content-security-policy.md).
 */

export interface Header {
  key: string;
  value: string;
}

export function contentSecurityPolicy(dev: boolean): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // In development React needs eval for its error overlay.
    "script-src": ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    // The planet models and the map draw into canvases and read textures as blobs.
    "img-src": ["'self'", "blob:", "data:"],
    "font-src": ["'self'"],
    // The search suggestions and the map fetch JSON from this site. In
    // development the dev server reloads the page over a WebSocket.
    "connect-src": ["'self'", ...(dev ? ["ws:"] : [])],
    "worker-src": ["'self'", "blob:"],
    "media-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(" ")}`)
    .join("; ");
}

export function securityHeaders(dev: boolean): Header[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(dev) },
    // For older browsers that do not know frame-ancestors.
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // The site uses none of these. Fullscreen stays allowed for the planet model.
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    // Browsers only take this from answers over HTTPS. On localhost it does nothing.
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  ];
}
