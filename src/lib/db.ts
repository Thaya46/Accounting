import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Connections each process may open. Serverless hosts run many copies of the app
 * at once, and a connection pooler in front of the database (PgBouncer) caps the
 * total, so on Vercel every copy keeps a small pool regardless of the URL's
 * `connection_limit`. `DATABASE_POOL_SIZE` overrides it anywhere.
 */
export function poolSize(env: Record<string, string | undefined> = process.env): number | null {
  const explicit = Number.parseInt(env.DATABASE_POOL_SIZE ?? "", 10);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return env.VERCEL ? 2 : null;
}

/** DATABASE_URL with `connection_limit` set to the pool size, when one applies. */
export function datasourceUrl(env: Record<string, string | undefined> = process.env): string | undefined {
  const size = poolSize(env);
  if (!size || !env.DATABASE_URL) return undefined;
  try {
    const url = new URL(env.DATABASE_URL);
    url.searchParams.set("connection_limit", String(size));
    return url.toString();
  } catch {
    return undefined;
  }
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: datasourceUrl(),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

// One client (and so one connection pool) per process, also in production: a
// module evaluated twice would otherwise open a second pool.
globalForPrisma.prisma = prisma;

/** A Prisma client or an interactive-transaction client. */
export type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;
