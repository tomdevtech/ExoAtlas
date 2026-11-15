/**
 * Picks the production deployment to roll back to, from the output of
 * `vercel list --environment production --json`. Used by
 * scripts/rollback-production.ts when the smoke test of a new production
 * deployment fails.
 */

/** One deployment as the Vercel CLI lists it. Only the fields we read. */
interface ListedDeployment {
  url?: unknown;
  uid?: unknown;
  createdAt?: unknown;
  created?: unknown;
  target?: unknown;
  state?: unknown;
  readyState?: unknown;
}

/** "https://exoatlas-abc.vercel.app/" and "exoatlas-abc.vercel.app" are the same deployment. */
export function deploymentHost(url: string): string {
  return url.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
}

function deploymentsOf(output: unknown): ListedDeployment[] {
  if (Array.isArray(output)) return output;
  if (output && typeof output === "object" && Array.isArray((output as { deployments?: unknown }).deployments)) {
    return (output as { deployments: ListedDeployment[] }).deployments;
  }
  throw new Error("The Vercel CLI did not list any deployments.");
}

/**
 * The newest ready production deployment other than the failed one, as its
 * host name, or `null` when there is none (the failed one is the first).
 */
export function pickRollbackTarget(output: unknown, failedUrl: string): string | null {
  const failed = deploymentHost(failedUrl);
  const candidates = deploymentsOf(output)
    .filter((d) => typeof d.url === "string" && deploymentHost(d.url) !== failed)
    .filter((d) => d.target === undefined || d.target === "production")
    .filter((d) => {
      const state = d.state ?? d.readyState;
      return state === undefined || state === "READY";
    })
    .map((d) => ({ host: deploymentHost(d.url as string), created: Number(d.createdAt ?? d.created ?? 0) }))
    .sort((a, b) => b.created - a.created);
  return candidates[0]?.host ?? null;
}
