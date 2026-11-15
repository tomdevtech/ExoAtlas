/**
 * Brings the database up to date before Vercel builds a production deployment.
 * vercel.json runs it ahead of `npm run build`:
 *
 *   npm run db:migrate-on-deploy
 *
 * It only migrates when VERCEL_ENV is "production", or when
 * DATABASE_MIGRATE_ON_BUILD is "true" (for preview deployments that have a
 * database of their own). Everywhere else, including a local `npm run build`,
 * it does nothing.
 *
 * It connects through DATABASE_URL_UNPOOLED when that is set, because changes
 * to the tables should not go through a pooler. If a migration fails, the build
 * fails and the deployment that is live stays as it is.
 */
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

async function main() {
  const production = process.env.VERCEL_ENV === "production";
  const forced = process.env.DATABASE_MIGRATE_ON_BUILD?.trim().toLowerCase() === "true";
  if (!production && !forced) {
    console.log("Migrations skipped: not a production deployment.");
    return;
  }

  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) {
    throw new Error("Neither DATABASE_URL_UNPOOLED nor DATABASE_URL is set.");
  }

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: join(process.cwd(), "drizzle") });
    console.log("Migrations applied.");
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
