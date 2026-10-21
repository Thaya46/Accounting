/**
 * Sends scheduled summary emails (previous day / previous month) to workspaces
 * that enabled them. Schedule with cron (macOS/Linux) or Task Scheduler (Windows):
 *   npm run summaries -- daily      # e.g. every day at 07:00
 *   npm run summaries -- monthly    # e.g. on the 1st at 07:00
 */
import "dotenv/config";
import { runScheduledSummaries } from "../src/lib/summaries";
import { prisma } from "../src/lib/db";

const period = process.argv[2];
if (period !== "daily" && period !== "monthly") {
  console.error("Usage: npm run summaries -- daily|monthly");
  process.exit(1);
}
runScheduledSummaries(period)
  .then((r) => console.log(JSON.stringify(r, null, 2)))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
