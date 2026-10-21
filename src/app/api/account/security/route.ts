import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, apiAuth, badRequest, json, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { decrypt } from "@/lib/auth/crypto";
import { issueRecoveryCodes } from "@/lib/auth/flows";
import { hashPassword, passwordSchema, verifyPassword } from "@/lib/auth/password";
import { rateLimit } from "@/lib/auth/rate-limit";
import { isMfaRequired, requestMeta, revokeAllSessions } from "@/lib/auth/session";
import { verifyTotp } from "@/lib/auth/totp";
import { sendEmail } from "@/lib/email/send";
import { mfaNotificationEmail } from "@/lib/email/templates";

/** Security overview: MFA state, recovery codes left, active sessions. */
export const GET = route(async () => {
  const { user, sessionId } = await apiAuth();
  const [remaining, sessions, required] = await Promise.all([
    prisma.recoveryCode.count({ where: { userId: user.id, usedAt: null } }),
    prisma.session.findMany({
      where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: "desc" },
      select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true },
    }),
    isMfaRequired(user.id),
  ]);
  return json({
    mfaEnabled: user.mfaEnabled,
    mfaRequired: required,
    recoveryCodesRemaining: remaining,
    sessions: sessions.map((s) => ({ ...s, current: s.id === sessionId })),
  });
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("change_password"), currentPassword: z.string().min(1), newPassword: passwordSchema }),
  z.object({ action: z.literal("regenerate_recovery_codes"), code: z.string().trim().regex(/^\d{6}$/) }),
  z.object({ action: z.literal("disable_mfa"), password: z.string().min(1), code: z.string().trim().regex(/^\d{6}$/) }),
  z.object({ action: z.literal("revoke_session"), sessionId: z.string().min(1) }),
  z.object({ action: z.literal("revoke_other_sessions") }),
]);

async function checkTotp(userId: string, code: string) {
  const cred = await prisma.mfaCredential.findUnique({ where: { userId } });
  if (!cred?.enabledAt) throw badRequest("Multi-factor authentication is not enabled");
  const step = verifyTotp(decrypt(cred.secretEncrypted), code, { lastUsedStep: cred.lastUsedStep });
  if (step === null) throw new ApiError(401, "That authenticator code is not valid.", "INVALID_CODE");
  await prisma.mfaCredential.update({ where: { id: cred.id }, data: { lastUsedStep: step } });
}

export const POST = route(async (req) => {
  const { user, sessionId } = await apiAuth();
  const body = await parseBody(req, actionSchema);
  const meta = await requestMeta();
  const actor = { id: user.id, name: user.name, email: user.email };
  const limit = await rateLimit(`security:${user.id}`, 20, 15 * 60);
  if (!limit.allowed) throw new ApiError(429, "Too many attempts. Try again later.", "RATE_LIMITED");

  switch (body.action) {
    case "change_password": {
      const record = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      if (!(await verifyPassword(body.currentPassword, record.passwordHash))) throw new ApiError(401, "Your current password is not correct.", "INVALID_CREDENTIALS");
      await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(body.newPassword) } });
      await revokeAllSessions(user.id, sessionId);
      await audit(prisma, { actor, entityType: "USER", entityId: user.id, action: "PASSWORD_CHANGED", ip: meta.ip, userAgent: meta.userAgent });
      return json({ ok: true, message: "Password changed. Other sessions were signed out." });
    }
    case "regenerate_recovery_codes": {
      await checkTotp(user.id, body.code);
      const codes = await issueRecoveryCodes(user.id);
      await audit(prisma, { actor, entityType: "USER", entityId: user.id, action: "MFA_RECOVERY_CODES_REGENERATED", ip: meta.ip, userAgent: meta.userAgent });
      await sendEmail({ to: user.email, toName: user.name, ...mfaNotificationEmail({ name: user.name, event: "recovery_regenerated" }), template: "MFA_NOTIFICATION", userId: user.id });
      return json({ recoveryCodes: codes });
    }
    case "disable_mfa": {
      if (await isMfaRequired(user.id)) throw new ApiError(403, "Your role requires two-step verification, so it cannot be turned off.", "MFA_REQUIRED");
      const record = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      if (!(await verifyPassword(body.password, record.passwordHash))) throw new ApiError(401, "Your password is not correct.", "INVALID_CREDENTIALS");
      await checkTotp(user.id, body.code);
      await prisma.$transaction([prisma.mfaCredential.delete({ where: { userId: user.id } }), prisma.recoveryCode.deleteMany({ where: { userId: user.id } })]);
      await audit(prisma, { actor, entityType: "USER", entityId: user.id, action: "MFA_DISABLED", ip: meta.ip, userAgent: meta.userAgent });
      await sendEmail({ to: user.email, toName: user.name, ...mfaNotificationEmail({ name: user.name, event: "disabled" }), template: "MFA_NOTIFICATION", userId: user.id });
      return json({ ok: true });
    }
    case "revoke_session": {
      await prisma.session.updateMany({ where: { id: body.sessionId, userId: user.id }, data: { revokedAt: new Date() } });
      await audit(prisma, { actor, entityType: "SESSION", entityId: body.sessionId, action: "SESSION_REVOKED", ip: meta.ip, userAgent: meta.userAgent });
      return json({ ok: true, signedOut: body.sessionId === sessionId });
    }
    case "revoke_other_sessions": {
      await revokeAllSessions(user.id, sessionId);
      await audit(prisma, { actor, entityType: "SESSION", action: "OTHER_SESSIONS_REVOKED", ip: meta.ip, userAgent: meta.userAgent });
      return json({ ok: true });
    }
  }
});
