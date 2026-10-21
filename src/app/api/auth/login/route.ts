import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, json, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { verifyPassword } from "@/lib/auth/password";
import { rateLimit, clearRateLimit } from "@/lib/auth/rate-limit";
import { createSession, isMfaRequired, requestMeta } from "@/lib/auth/session";
import { homePathFor } from "@/lib/auth/flows";
import { sendEmail } from "@/lib/email/send";
import { suspiciousLoginEmail } from "@/lib/email/templates";

const schema = z.object({ email: z.string().trim().toLowerCase().email().max(200), password: z.string().min(1).max(200) });

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

export const POST = route(async (req) => {
  const { email, password } = await parseBody(req, schema);
  const meta = await requestMeta();

  const ipLimit = await rateLimit(`login:ip:${meta.ip}`, 30, 15 * 60);
  const emailLimit = await rateLimit(`login:email:${email}`, 10, 15 * 60);
  if (!ipLimit.allowed || !emailLimit.allowed) {
    throw new ApiError(429, "Too many sign-in attempts. Please wait a few minutes and try again.", "RATE_LIMITED");
  }

  const user = await prisma.user.findUnique({ where: { email }, include: { mfaCredential: { select: { enabledAt: true } } } });
  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    throw new ApiError(423, "This account is temporarily locked after repeated failed sign-ins. Try again later or reset your password.", "LOCKED");
  }

  const ok = await verifyPassword(password, user?.passwordHash);
  if (!user || !ok || user.status === "PENDING") {
    if (user) {
      const failures = user.failedLoginCount + 1;
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: failures, lockedUntil: failures >= MAX_FAILURES ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null },
      });
      await audit(prisma, { actor: { id: user.id, name: user.name, email: user.email }, entityType: "USER", entityId: user.id, action: "LOGIN_FAILED", ip: meta.ip, userAgent: meta.userAgent });
    }
    throw new ApiError(401, "Invalid email or password.", "INVALID_CREDENTIALS");
  }
  if (user.status === "DISABLED") throw new ApiError(403, "This account has been disabled. Contact your administrator.", "DISABLED");

  const previousIp = user.lastLoginIp;
  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginIp: meta.ip },
  });
  await clearRateLimit(`login:email:${email}`);

  const mfaEnabled = Boolean(user.mfaCredential?.enabledAt);
  const mfaRequired = await isMfaRequired(user.id);
  const last = await prisma.session.findFirst({ where: { userId: user.id, activeWorkspaceId: { not: null } }, orderBy: { lastSeenAt: "desc" }, select: { activeWorkspaceId: true } });
  await createSession(user.id, { mfaVerified: !mfaEnabled && !mfaRequired, activeWorkspaceId: last?.activeWorkspaceId ?? null });
  await audit(prisma, { actor: { id: user.id, name: user.name, email: user.email }, entityType: "USER", entityId: user.id, action: "LOGIN", ip: meta.ip, userAgent: meta.userAgent, after: { mfaPending: mfaEnabled || mfaRequired } });

  if (previousIp && previousIp !== meta.ip) {
    const mail = suspiciousLoginEmail({ name: user.name, ip: meta.ip, userAgent: meta.userAgent, when: new Date().toUTCString() });
    await sendEmail({ to: user.email, toName: user.name, ...mail, template: "SUSPICIOUS_LOGIN", userId: user.id });
  }

  const next = mfaEnabled ? "/mfa" : mfaRequired ? "/setup-mfa" : await homePathFor(user, last?.activeWorkspaceId);
  return json({ next });
});
