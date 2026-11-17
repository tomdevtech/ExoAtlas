/**
 * Applies database migrations before a Vercel build (run from vercel.json).
 *
 *   npm run db:migrate-on-deploy
 *
 * It migrates only when VERCEL_ENV is "production" or DATABASE_MIGRATE_ON_BUILD is
 * "true" (for previews with their own database), so a local build never migrates.
 * It prefers DATABASE_URL_UNPOOLED over DATABASE_URL, because schema changes should
 * not go through a pooler. A failed migration fails the build and keeps the live deployment.
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
