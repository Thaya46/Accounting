/**
 * `npm run dev` — starts the bundled PostgreSQL (when DATABASE_URL targets it)
 * and the Next.js dev server together. Ctrl+C stops both.
 */
import "dotenv/config";
import { spawn } from "node:child_process";
import { ensureLocalPostgres } from "./local-postgres";

async function main() {
  const pg = await ensureLocalPostgres();
  const nextBin = require.resolve("next/dist/bin/next");
  const child = spawn(process.execPath, [nextBin, "dev", "--turbopack", "-p", process.env.PORT ?? "3000"], {
    stdio: "inherit",
    env: process.env,
  });
  const shutdown = async (code = 0) => {
    child.kill();
    if (pg) await pg.stop().catch(() => {});
    process.exit(code);
  };
  child.on("exit", (code) => shutdown(code ?? 0));
  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
