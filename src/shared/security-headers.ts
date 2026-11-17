/**
 * HTTP headers sent with every response. next.config.ts applies them, and tests/unit/shared/security-headers.test.ts
 * and tests/e2e/security.spec.ts check them.
 *
 * The Content Security Policy only allows scripts, styles, images, fonts and data from this site and forbids
 * framing by other sites. Scripts need 'unsafe-inline' because Next.js inlines small data scripts into every page.
 * Nonces would avoid that, but they force every page to render per request and lose prerendering
 * (see the Next.js guide content-security-policy.md).
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
    // The search suggestions and the map fetch JSON from this site. In development the dev server
    // reloads the page over a WebSocket.
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
    // Browsers only honour this header over HTTPS, so on localhost it has no effect.
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  ];
}
