/**
 * Local PostgreSQL without Docker.
 *
 * Uses the `embedded-postgres` package, which ships real PostgreSQL 17 binaries
 * for Windows, macOS and Linux as npm packages. Data lives in ./.pgdata.
 * If DATABASE_URL points anywhere other than the bundled local server, nothing
 * is started and your own PostgreSQL is used.
 *
 *   npx tsx scripts/local-postgres.ts start   # run in the foreground (Ctrl+C to stop)
 */
import "dotenv/config";
import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const DATA_DIR = path.resolve(process.cwd(), ".pgdata");

export function localDbConfig() {
  const url = new URL(process.env.DATABASE_URL ?? "postgresql://vledger:vledger@localhost:5433/vledger");
  const localPort = Number(process.env.LOCAL_PG_PORT ?? 5433);
  const isLocal =
    ["localhost", "127.0.0.1"].includes(url.hostname) && Number(url.port || 5432) === localPort;
  return {
    isLocal,
    port: localPort,
    user: decodeURIComponent(url.username || "vledger"),
    password: decodeURIComponent(url.password || "vledger"),
    database: url.pathname.replace(/^\//, "") || "vledger",
  };
}

export function isPortOpen(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    socket.once("connect", () => {
      socket.end();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

/**
 * Starts the bundled PostgreSQL when DATABASE_URL targets it and it is not
 * already running. Returns the instance (stop it on exit) or null.
 */
export async function ensureLocalPostgres(extraDatabases: string[] = []) {
  const cfg = localDbConfig();
  if (!cfg.isLocal) return null;
  if (await isPortOpen(cfg.port)) return null;

  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    persistent: true,
    authMethod: "scram-sha-256",
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: () => {},
    onError: (e) => {
      const msg = String(e instanceof Error ? e.message : e);
      if (/ERROR|FATAL|PANIC/.test(msg)) console.error(`[postgres] ${msg.trim()}`);
    },
  });

  if (!fs.existsSync(path.join(DATA_DIR, "PG_VERSION"))) {
    console.log(`[postgres] Initialising new cluster in ${DATA_DIR}`);
    await pg.initialise();
  }
  await pg.start();

  const client = pg.getPgClient();
  await client.connect();
  for (const db of [cfg.database, ...extraDatabases]) {
    const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [db]);
    if (exists.rowCount === 0) {
      await client.query(`CREATE DATABASE "${db.replace(/"/g, "")}"`);
      console.log(`[postgres] Created database ${db}`);
    }
  }
  await client.end();
  console.log(`[postgres] Running on port ${cfg.port}`);
  return pg;
}

async function main() {
  const cmd = process.argv[2] ?? "start";
  if (cmd !== "start") {
    console.log("Stopping: press Ctrl+C in the terminal running `npm run db:start` (or `npm run dev`).");
    return;
  }
  const testDb = process.env.TEST_DATABASE_URL ? new URL(process.env.TEST_DATABASE_URL).pathname.slice(1) : undefined;
  const pg = await ensureLocalPostgres(testDb ? [testDb] : []);
  if (!pg) {
    console.log("[postgres] Already running or DATABASE_URL points to an external server — nothing to start.");
    return;
  }
  console.log("[postgres] Press Ctrl+C to stop.");
  const stop = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  setInterval(() => {}, 1 << 30);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]).includes("local-postgres");
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
