/**
 * Prepares a test database: creates it if needed, migrates it, empties it and
 * seeds the test catalogue from ./catalog.ts. Test database names must end in
 * `_test` or `_e2e`, so that a configuration mistake cannot wipe the
 * development database from DATABASE_URL.
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

/** This is the server from docker-compose.yml; the database name is appended. */
const LOCAL = "postgres://exofinder:exofinder@localhost:5432/";

/** Vitest and Playwright do not read .env.local themselves. Variables that are already set take precedence. */
function localEnv(name: "TEST_DATABASE_URL" | "E2E_DATABASE_URL"): string | undefined {
  if (process.env[name] === undefined && existsSync(".env.local")) {
    process.loadEnvFile(".env.local");
  }
  return process.env[name] || undefined;
}

/** Returns the database for the Vitest database tests (`npm run test:db`). */
export function testDatabaseUrl(): string {
  return localEnv("TEST_DATABASE_URL") ?? `${LOCAL}exofinder_test`;
}

/** Returns the database for the browser tests (`npm run test:e2e`). */
export function e2eDatabaseUrl(): string {
  return localEnv("E2E_DATABASE_URL") ?? `${LOCAL}exofinder_e2e`;
}

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

async function ensureDatabase(url: string): Promise<void> {
  const name = databaseName(url);
  const server = new URL(url);
  server.pathname = "/postgres";
  const sql = postgres(server.toString(), { max: 1, onnotice: () => {} });
  try {
    const existing = await sql`select 1 from pg_database where datname = ${name}`;
    // Interpolating the name is safe because assertTestDatabase allows only a-z, 0-9 and _.
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

/** Runs one sync with NASA's response replaced by `rows`. */
export async function syncWith(rows: unknown[]): Promise<void> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(rows));
  try {
    // The sync would otherwise reject the small test catalogue as implausibly short.
    await runSync({ force: true });
  } finally {
    globalThis.fetch = realFetch;
  }
}

/**
 * Seeds the solar system, two sync runs (NASA withdraws Retracted-1 b in the
 * second one) and two former names, so that redirects from old addresses can
 * be tested.
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

/** Brings the test database at `url` into its known state and points `getDb()` to it. */
export async function prepareTestDatabase(url: string): Promise<void> {
  assertTestDatabase(url);
  await ensureDatabase(url);
  await migrateAndEmpty(url);
  await closeDb();
  process.env.DATABASE_URL = url;
  await seed();
}
