import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Next.js reloads modules again and again during development. Without this
// global slot every reload would open another set of database connections.
const globalForDb = globalThis as {
  exofinderSql?: postgres.Sql;
  exofinderDb?: PostgresJsDatabase<typeof schema>;
};

/**
 * How many connections to open and how to use them, read from the environment.
 *
 * - `DATABASE_POOL_SIZE`: connections per running instance, 5 by default. A
 *   host like Vercel starts many instances at once, so the sum can reach the
 *   limit of the database. A pooled database address avoids that.
 * - `DATABASE_PREPARE=false`: no prepared statements. Needed behind a pooler
 *   in transaction mode that does not support them, such as port 6543 at
 *   Supabase.
 *
 * Idle connections close after 20 seconds, so an instance that the host
 * freezes or ends does not keep them open.
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
 * The address to connect to.
 *
 * Inside the Next.js server (`inNextServer`) the website only reads. There it
 * takes `DATABASE_URL_READONLY` when that is set: a role that may only read,
 * with a time limit per query (see scripts/create-readonly-role.ts). Scripts
 * and tests run outside Next.js and write, so they always take `DATABASE_URL`.
 */
export function databaseUrl(
  env: Record<string, string | undefined>,
  inNextServer: boolean,
): string | undefined {
  const readOnly = env.DATABASE_URL_READONLY?.trim();
  if (inNextServer && readOnly) return readOnly;
  return env.DATABASE_URL?.trim() || undefined;
}

/**
 * The database. It connects on the first call, not on import, so `next build`
 * also works when no database is reachable.
 */
export function getDb() {
  if (!globalForDb.exofinderDb) {
    // Written out in full, so that Next.js can replace it when it bundles the server.
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

/** Closes the connections. Scripts need this at the end, otherwise Node keeps running. */
export async function closeDb() {
  await globalForDb.exofinderSql?.end();
  globalForDb.exofinderSql = undefined;
  globalForDb.exofinderDb = undefined;
}
