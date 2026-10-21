import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, json, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { sha256 } from "@/lib/auth/crypto";
import { hashPassword, passwordSchema } from "@/lib/auth/password";
import { rateLimit } from "@/lib/auth/rate-limit";
import { requestMeta, revokeAllSessions } from "@/lib/auth/session";

const schema = z.object({ token: z.string().min(20).max(200), password: passwordSchema });

export const POST = route(async (req) => {
  const { token, password } = await parseBody(req, schema);
  const meta = await requestMeta();
  const limit = await rateLimit(`reset-submit:${meta.ip}`, 20, 60 * 60);
  if (!limit.allowed) throw new ApiError(429, "Too many attempts. Try again later.", "RATE_LIMITED");

  const record = await prisma.authToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!record || record.type !== "PASSWORD_RESET" || record.usedAt || record.expiresAt < new Date() || record.user.status !== "ACTIVE") {
    throw new ApiError(400, "This reset link is invalid or has expired. Request a new one.", "INVALID_TOKEN");
  }
  const passwordHash = await hashPassword(password);
  const consumed = await prisma.authToken.updateMany({ where: { id: record.id, usedAt: null }, data: { usedAt: new Date() } });
  if (consumed.count !== 1) throw new ApiError(400, "This reset link was already used.", "INVALID_TOKEN");

  await prisma.user.update({ where: { id: record.userId }, data: { passwordHash, failedLoginCount: 0, lockedUntil: null } });
  await revokeAllSessions(record.userId);
  await audit(prisma, {
    actor: { id: record.user.id, name: record.user.name, email: record.user.email },
    entityType: "USER",
    entityId: record.userId,
    action: "PASSWORD_RESET",
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  return json({ ok: true });
});
