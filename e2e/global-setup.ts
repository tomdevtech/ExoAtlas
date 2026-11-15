import { closeDb } from "@/db/client";
import { e2eDatabaseUrl, prepareTestDatabase } from "@/test/db";

/** Runs once before the browser tests: fills the database the app under test reads. */
export default async function globalSetup() {
  await prepareTestDatabase(e2eDatabaseUrl());
  await closeDb();
}
