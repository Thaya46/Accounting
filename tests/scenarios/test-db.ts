/**
 * Creates a brand-new, fully migrated PostgreSQL database for a scenario test
 * run (never touches DATABASE_URL's database). Uses TEST_DATABASE_URL's server;
 * the bundled local PostgreSQL is started automatically when needed.
 */
import { execSync } from "node:child_process";
import { Client } from "pg";
import { ensureLocalPostgres, isPortOpen } from "../../scripts/local-postgres";

export async function createTestDatabase() {
  const base = new URL(process.env.TEST_DATABASE_URL ?? "postgresql://vledger:vledger@localhost:5433/vledger_test?schema=public");
  let embedded: Awaited<ReturnType<typeof ensureLocalPostgres>> = null;

  const port = Number(base.port || 5432);
  if (["localhost", "127.0.0.1"].includes(base.hostname) && !(await isPortOpen(port))) {
    const original = process.env.DATABASE_URL;
    process.env.DATABASE_URL = base.toString();
    embedded = await ensureLocalPostgres();
    process.env.DATABASE_URL = original;
  }

  const name = `vledger_test_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const adminUrl = new URL(base);
  adminUrl.pathname = "/postgres";
  adminUrl.search = "";
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();

  const url = new URL(base);
  url.pathname = `/${name}`;
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: url.toString(), DIRECT_DATABASE_URL: url.toString() },
    stdio: "pipe",
  });
  process.env.DATABASE_URL = url.toString();
  process.env.DIRECT_DATABASE_URL = url.toString();

  return {
    url: url.toString(),
    /** Drops only the database this run created. */
    async drop() {
      const c = new Client({ connectionString: adminUrl.toString() });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await c.end();
      if (embedded) await embedded.stop();
    },
  };
}
