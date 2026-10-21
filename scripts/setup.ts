/**
 * One-time local setup: start PostgreSQL (if bundled), apply migrations, seed.
 *   npm run setup
 */
import "dotenv/config";
import { execSync } from "node:child_process";
import { ensureLocalPostgres } from "./local-postgres";

async function main() {
  const testDb = process.env.TEST_DATABASE_URL ? new URL(process.env.TEST_DATABASE_URL).pathname.slice(1) : undefined;
  const pg = await ensureLocalPostgres(testDb ? [testDb] : []);
  try {
    execSync("npx prisma migrate deploy", { stdio: "inherit" });
    execSync("npx tsx prisma/seed.ts", { stdio: "inherit" });
    console.log("\n✔ Setup complete. Run `npm run dev` and open http://localhost:3000");
  } finally {
    if (pg) await pg.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
