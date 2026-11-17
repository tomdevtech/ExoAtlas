/**
 * Audits all dependencies, including dev tools, and fails on any high or critical
 * advisory that src/deploy/audit.ts does not temporarily accept.
 *
 *   npm run audit:tools
 */
import { spawnSync } from "node:child_process";
import { AUDIT_EXCEPTIONS, judgeAudit, type AuditReport } from "@/deploy/audit";

// npm exits with 1 when it finds anything, but the report is on stdout either way.
// The command runs through the shell so that npm is also found on Windows.
const audit = spawnSync("npm audit --json", { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: true });
let report: AuditReport;
try {
  report = JSON.parse(audit.stdout) as AuditReport;
} catch {
  console.error(audit.stderr || "npm audit gave no report.");
  process.exit(2);
}
if (!report.vulnerabilities) {
  console.error("npm audit gave a report without vulnerabilities: is the format still 2?");
  process.exit(2);
}

const today = new Date().toISOString().slice(0, 10);
const { failures, notes } = judgeAudit(report, AUDIT_EXCEPTIONS, today);
const warn = process.env.GITHUB_ACTIONS ? "::warning::" : "";
for (const note of notes) console.log(`${warn}${note}`);
for (const failure of failures) console.error(failure);
if (failures.length > 0) process.exit(1);
console.log("No advisory rated high or critical, apart from the ones accepted above.");
