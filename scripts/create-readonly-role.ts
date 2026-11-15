/**
 * Creates the database role the website reads with, or gives it a new
 * password. Run it once after the first deployment, and again whenever the
 * password should change:
 *
 *   DATABASE_URL="<owner, pooled>" DATABASE_URL_UNPOOLED="<owner, direct>" npm run db:readonly-role
 *
 * It connects as the owner (direct address if given) and prints the pooled
 * address of the new role. Store that in Vercel as DATABASE_URL_READONLY
 * (Production) and deploy again. The password is shown only this once and
 * is not saved anywhere.
 */
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { READONLY_ROLE, readonlyRoleStatements, STATEMENT_TIMEOUT, withRole } from "@/db/readonly";

async function main() {
  const pooled = process.env.DATABASE_URL?.trim();
  const direct = process.env.DATABASE_URL_UNPOOLED?.trim() || pooled;
  if (!pooled || !direct) {
    throw new Error("Set DATABASE_URL (and if possible DATABASE_URL_UNPOOLED) to the owner's addresses.");
  }

  const password = randomBytes(24).toString("base64url");
  const sql = postgres(direct, { max: 1, onnotice: () => {} });
  try {
    const [{ database }] = await sql<{ database: string }[]>`select current_database() as database`;
    for (const statement of readonlyRoleStatements(database, password)) {
      await sql.unsafe(statement);
    }
    console.log(
      `Role ${READONLY_ROLE} is ready: may only read, ${STATEMENT_TIMEOUT} per query.\n\n` +
        "Store this address in Vercel as DATABASE_URL_READONLY (Production), then redeploy:\n\n" +
        `${withRole(pooled, password)}\n`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
