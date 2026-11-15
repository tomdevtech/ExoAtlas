/**
 * Puts the previous production deployment back live on Vercel. The workflow
 * .github/workflows/deploy-check.yml runs it when the smoke test of a new
 * production deployment fails:
 *
 *   FAILED_DEPLOYMENT_URL=https://exoatlas-abc123.vercel.app npm run deploy:rollback
 *
 * Needs VERCEL_TOKEN, VERCEL_ORG_ID and VERCEL_PROJECT_ID (see
 * docs/DEPLOYMENT.md). The logic lives in src/deploy/rollback.ts.
 *
 * Only the code goes back. The database stays as the new deployment's
 * migrations left it, which the old code must cope with (see "Migrations" in
 * docs/DEPLOYMENT.md).
 */
import { spawnSync } from "node:child_process";
import { pickRollbackTarget } from "@/deploy/rollback";

/** A fixed version, so a new release of the CLI cannot change what happens here. */
const VERCEL_CLI = "vercel@65.9.0";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set. See docs/DEPLOYMENT.md, "Automatic rollback".`);
  return value;
}

function vercel(args: string[], token: string): string {
  const result = spawnSync("npx", ["-y", VERCEL_CLI, ...args, "--token", token], {
    encoding: "utf8",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`vercel ${args[0]} failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

/** The CLI may print a notice before the JSON. */
function parseJson(output: string): unknown {
  const start = output.search(/[[{]/);
  if (start < 0) throw new Error(`No JSON in the output of the Vercel CLI:\n${output}`);
  return JSON.parse(output.slice(start));
}

function main() {
  const token = required("VERCEL_TOKEN");
  required("VERCEL_ORG_ID");
  required("VERCEL_PROJECT_ID");
  const failed = required("FAILED_DEPLOYMENT_URL");

  const listed = vercel(["list", "--environment", "production", "--status", "READY", "--json", "--limit", "20"], token);
  const target = pickRollbackTarget(parseJson(listed), failed);
  if (!target) {
    throw new Error("There is no earlier production deployment to roll back to.");
  }

  console.log(`Rolling back from ${failed} to ${target} …`);
  vercel(["rollback", target, "--yes", "--timeout", "5m"], token);
  console.log(`Done: ${target} is live again.`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
