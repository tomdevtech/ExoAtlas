import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Next.js reloads modules repeatedly in development. Keeping the client on globalThis stops every reload
// from opening another set of database connections.
const globalForDb = globalThis as {
  exofinderSql?: postgres.Sql;
  exofinderDb?: PostgresJsDatabase<typeof schema>;
};

/**
 * Connection pool settings read from the environment.
 *
 * - `DATABASE_POOL_SIZE`: connections per instance, 5 by default. Hosts like Vercel run many instances at
 *   once, so the total can reach the database limit; a pooled database URL avoids that.
 * - `DATABASE_PREPARE=false`: disables prepared statements, which transaction-mode poolers such as
 *   Supabase on port 6543 do not support.
 *
 * Idle connections close after 20 seconds, so an instance the host freezes or stops does not hold them open.
 */
export function poolOptions(env: Record<string, string | undefined>) {
  const size = Number(env.DATABASE_POOL_SIZE);
  return {
    max: Number.isInteger(size) && size > 0 ? size : 5,
    prepare: env.DATABASE_PREPARE?.trim().toLowerCase() !== "false",
    idle_timeout: 20,
  };
}

/**
 * Returns the database URL. Inside the Next.js server the site only reads, so it uses `DATABASE_URL_READONLY`
 * when set: a read-only role with a per-query time limit (see scripts/create-readonly-role.ts). Scripts and
 * tests run outside Next.js and write, so they always use `DATABASE_URL`.
 */
export function databaseUrl(
  env: Record<string, string | undefined>,
  inNextServer: boolean,
): string | undefined {
  const readOnly = env.DATABASE_URL_READONLY?.trim();
  if (inNextServer && readOnly) return readOnly;
  return env.DATABASE_URL?.trim() || undefined;
}

/** Returns the shared database client. It connects on the first call, not on import, so `next build` works without a database. */
export function getDb() {
  if (!globalForDb.exofinderDb) {
    // Written out in full so that Next.js can replace it at build time when it bundles the server.
    const inNextServer = Boolean(process.env.NEXT_RUNTIME);
    const url = databaseUrl(process.env, inNextServer);
    if (!url) {
      throw new Error("DATABASE_URL is not set. See .env.example.");
    }
    globalForDb.exofinderSql = postgres(url, { ...poolOptions(process.env), onnotice: () => {} });
    globalForDb.exofinderDb = drizzle(globalForDb.exofinderSql, { schema });
  }
  return globalForDb.exofinderDb;
}

/** Closes the connections. Scripts must call this at the end, otherwise Node keeps running. */
export async function closeDb() {
  await globalForDb.exofinderSql?.end();
  globalForDb.exofinderSql = undefined;
  globalForDb.exofinderDb = undefined;
}
