/** What GET /health answers. Deliberately small: nothing in it helps an attacker. */
export interface HealthReport {
  status: "ok" | "error";
  database: "ok" | "unreachable";
  /** The short Git commit of the running deployment, so a check can tell which one answered. */
  commit: string | null;
}

/** A database that hangs counts as down after this long. */
export const DATABASE_TIMEOUT_MS = 3_000;

/** The running commit on Vercel. Locally there is none. */
export function currentCommit(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const sha = env.VERCEL_GIT_COMMIT_SHA?.trim();
  return sha ? sha.slice(0, 7) : null;
}

/**
 * Asks the database for a sign of life. Never throws: a failure, or no answer
 * within `timeoutMs`, makes the report say "error".
 */
export async function checkHealth(
  ping: () => Promise<unknown>,
  { timeoutMs = DATABASE_TIMEOUT_MS, commit = currentCommit() } = {},
): Promise<HealthReport> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`No answer within ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    await Promise.race([ping(), timeout]);
    return { status: "ok", database: "ok", commit };
  } catch (error) {
    console.error("Health check: the database did not answer:", error);
    return { status: "error", database: "unreachable", commit };
  } finally {
    clearTimeout(timer);
  }
}
