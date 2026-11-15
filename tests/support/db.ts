/**
 * Prepares a database for the tests: creates it when it is missing, applies
 * the migrations, empties it and fills it with the small test catalogue from
 * ./catalog.ts.
 *
 * The tests never touch the database from DATABASE_URL. They use their own
 * databases, whose names must end in `_test` or `_e2e`, so that a mistake in
 * the configuration cannot empty the development database.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { seedSolarSystem } from "@/app/solar-system/seed";
import { runSync } from "@/app/sync/run";
import { closeDb, getDb } from "@/db/client";
import { planetAliases, planets, starAliases, stars } from "@/db/schema";
import { FIXTURE_ROWS, FIXTURE_ROWS_AFTER_RETRACTION } from "@tests/support/catalog";

/** The database from docker-compose.yml, with the name the tests may use. */
const LOCAL = "postgres://exoatlas:exoatlas@localhost:5432/";

/** Vitest and Playwright do not read .env.local themselves. Variables set before win. */
function localEnv(name: "TEST_DATABASE_URL" | "E2E_DATABASE_URL"): string | undefined {
  if (process.env[name] === undefined && existsSync(".env.local")) {
    process.loadEnvFile(".env.local");
  }
  return process.env[name] || undefined;
}

/** Database of the Vitest database tests (`npm run test:db`). */
export function testDatabaseUrl(): string {
  return localEnv("TEST_DATABASE_URL") ?? `${LOCAL}exoatlas_test`;
}

/** Database of the browser tests (`npm run test:e2e`). */
export function e2eDatabaseUrl(): string {
  return localEnv("E2E_DATABASE_URL") ?? `${LOCAL}exoatlas_e2e`;
}

/** The name of the database in a connection URL. */
function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

/** Throws unless the URL names a database that is meant for tests. */
export function assertTestDatabase(url: string): void {
  const name = databaseName(url);
  if (!/^[a-z0-9_]+_(test|e2e)$/.test(name)) {
    throw new Error(
      `Refusing to use the database "${name}" for tests: its name must end in _test or _e2e.`,
    );
  }
}

/** Creates the database when it does not exist yet. */
async function ensureDatabase(url: string): Promise<void> {
  const name = databaseName(url);
  const server = new URL(url);
  server.pathname = "/postgres";
  const sql = postgres(server.toString(), { max: 1, onnotice: () => {} });
  try {
    const existing = await sql`select 1 from pg_database where datname = ${name}`;
    // The name was checked by assertTestDatabase: only a-z, 0-9 and _.
    if (existing.length === 0) await sql.unsafe(`create database "${name}"`);
  } finally {
    await sql.end();
  }
}

async function migrateAndEmpty(url: string): Promise<void> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: join(process.cwd(), "drizzle") });
    await sql`
      truncate planet_changes, planet_aliases, star_aliases, planets, stars, sync_runs
      restart identity cascade
    `;
  } finally {
    await sql.end();
  }
}

/** Runs one sync, with NASA's answer replaced by `rows`. */
export async function syncWith(rows: unknown[]): Promise<void> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(rows));
  try {
    // The test catalogue is far smaller than the real one, which the sync
    // would otherwise refuse as implausible.
    await runSync({ force: true });
  } finally {
    globalThis.fetch = realFetch;
  }
}

/**
 * Fills an empty database: the solar system, two sync runs (in the second one
 * NASA withdraws Retracted-1 b) and two former names, so the redirects from
 * old addresses can be tested.
 */
async function seed(): Promise<void> {
  await seedSolarSystem();
  await syncWith(FIXTURE_ROWS);
  await syncWith(FIXTURE_ROWS_AFTER_RETRACTION);

  const db = getDb();
  const [kepler22] = await db
    .select({ id: planets.id })
    .from(planets)
    .where(eq(planets.slug, "kepler-22-b"));
  await db.insert(planetAliases).values({ planetId: kepler22.id, slug: "koi-87-01", name: "KOI-87.01" });
  const [trappist] = await db
    .select({ id: stars.id })
    .from(stars)
    .where(eq(stars.slug, "trappist-1"));
  await db
    .insert(starAliases)
    .values({ starId: trappist.id, slug: "2mass-j23062928-0502285", name: "2MASS J23062928-0502285" });
}

/**
 * Brings the test database at `url` into its known state. Afterwards
 * `getDb()` points to it.
 */
export async function prepareTestDatabase(url: string): Promise<void> {
  assertTestDatabase(url);
  await ensureDatabase(url);
  await migrateAndEmpty(url);
  await closeDb();
  process.env.DATABASE_URL = url;
  await seed();
}
