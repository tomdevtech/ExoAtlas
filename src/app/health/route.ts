import { sql } from "drizzle-orm";
import { connection } from "next/server";
import { getDb } from "@/db/client";
import { checkHealth } from "./check";

/**
 * GET /health answers 200 when the site can reach its database, and 503 when
 * it cannot. The smoke test after each deployment and uptime monitors ask it
 * (see docs/DEPLOYMENT.md). It is never cached.
 */
export async function GET() {
  // Always at request time: a health check from the build would say nothing.
  await connection();
  const report = await checkHealth(() => getDb().execute(sql`select 1`));
  return Response.json(report, {
    status: report.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
