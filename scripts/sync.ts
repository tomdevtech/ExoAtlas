/**
 * Sync with the NASA Exoplanet Archive.
 *
 *   npm run sync             normal run
 *   npm run sync -- --force  write even when the response looks implausible
 *
 * The logic lives in src/app/sync. This file only starts it.
 */
import { runSync } from "@/app/sync/run";
import { closeDb } from "@/db/client";

async function main() {
  try {
    const counts = await runSync({
      force: process.argv.includes("--force"),
      log: console.log,
    });
    console.log(
      `Done: ${counts.added} added, ${counts.updated} updated, ${counts.unchanged} unchanged, ` +
        `${counts.removed} removed, ${counts.renamed} renamed.`,
    );
  } catch (error) {
    console.error(`Sync failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}

main();
