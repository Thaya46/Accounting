import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, json, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { decrypt } from "@/lib/auth/crypto";
import { consumeRecoveryCode, homePathFor } from "@/lib/auth/flows";
import { rateLimit } from "@/lib/auth/rate-limit";
import { getAuth, markSessionMfaVerified, requestMeta } from "@/lib/auth/session";
import { verifyTotp } from "@/lib/auth/totp";
import { sendEmail } from "@/lib/email/send";
import { mfaNotificationEmail } from "@/lib/email/templates";

const schema = z.object({ code: z.string().trim().min(6).max(20), recovery: z.boolean().optional() });

export const POST = route(async (req) => {
  const auth = await getAuth();
  if (!auth) throw new ApiError(401, "Your sign-in session expired. Sign in again.", "UNAUTHENTICATED");
  if (auth.session.mfaVerified) return json({ next: await homePathFor(auth.user, auth.session.activeWorkspaceId) });
  const { code, recovery } = await parseBody(req, schema);
  const meta = await requestMeta();

  const limit = await rateLimit(`mfa:${auth.session.id}`, 6, 5 * 60);
  if (!limit.allowed) throw new ApiError(429, "Too many attempts. Wait a few minutes or sign in again.", "RATE_LIMITED");

  const cred = await prisma.mfaCredential.findUnique({ where: { userId: auth.user.id } });
  if (!cred?.enabledAt) throw new ApiError(400, "Multi-factor authentication is not set up for this account.", "MFA_NOT_ENABLED");
  const actor = { id: auth.user.id, name: auth.user.name, email: auth.user.email };

  if (recovery) {
    if (!(await consumeRecoveryCode(auth.user.id, code))) {
      await audit(prisma, { actor, entityType: "USER", entityId: auth.user.id, action: "MFA_FAILED", ip: meta.ip, userAgent: meta.userAgent, reason: "recovery code" });
      throw new ApiError(401, "That recovery code is not valid or was already used.", "INVALID_CODE");
    }
    await audit(prisma, { actor, entityType: "USER", entityId: auth.user.id, action: "MFA_RECOVERY_CODE_USED", ip: meta.ip, userAgent: meta.userAgent });
    await sendEmail({ to: auth.user.email, toName: auth.user.name, ...mfaNotificationEmail({ name: auth.user.name, event: "recovery_used" }), template: "MFA_NOTIFICATION", userId: auth.user.id });
  } else {
    const step = verifyTotp(decrypt(cred.secretEncrypted), code, { lastUsedStep: cred.lastUsedStep });
    if (step === null) {
      await audit(prisma, { actor, entityType: "USER", entityId: auth.user.id, action: "MFA_FAILED", ip: meta.ip, userAgent: meta.userAgent });
      throw new ApiError(401, "That code is not valid. Check your authenticator app and try again.", "INVALID_CODE");
    }
    // Record the step so the same code cannot be replayed.
    await prisma.mfaCredential.update({ where: { id: cred.id }, data: { lastUsedStep: step } });
  }

  await markSessionMfaVerified(auth.session.id);
  await audit(prisma, { actor, entityType: "USER", entityId: auth.user.id, action: "MFA_VERIFIED", ip: meta.ip, userAgent: meta.userAgent });
  return json({ next: await homePathFor(auth.user, auth.session.activeWorkspaceId) });
});
