/**
 * Stores the Sun and its eight planets in the database.
 *
 *   npm run seed:sol
 *
 * It writes to the database given by DATABASE_URL.
 */
import { seedSolarSystem } from "@/app/solar-system/seed";
import { closeDb } from "@/db/client";

async function main() {
  try {
    const count = await seedSolarSystem();
    console.log(`Solar system stored: the Sun and ${count} planets.`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}

main();
