import { prisma } from "@/lib/db";

/**
 * Fixed-window rate limiter backed by PostgreSQL, so limits hold across
 * processes and restarts. Returns whether the call is allowed.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number) {
  const rows = await prisma.$queryRaw<{ count: number; windowStart: Date }[]>`
    INSERT INTO rate_limits ("key", "count", "windowStart") VALUES (${key}, 1, now())
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN rate_limits."windowStart" < now() - make_interval(secs => ${windowSeconds}::int)
                     THEN 1 ELSE rate_limits."count" + 1 END,
      "windowStart" = CASE WHEN rate_limits."windowStart" < now() - make_interval(secs => ${windowSeconds}::int)
                     THEN now() ELSE rate_limits."windowStart" END
    RETURNING "count", "windowStart"`;
  const row = rows[0];
  const retryAfter = Math.max(0, Math.ceil((row.windowStart.getTime() + windowSeconds * 1000 - Date.now()) / 1000));
  return { allowed: row.count <= limit, remaining: Math.max(0, limit - row.count), retryAfter };
}

export async function clearRateLimit(key: string) {
  await prisma.rateLimit.deleteMany({ where: { key } });
}
