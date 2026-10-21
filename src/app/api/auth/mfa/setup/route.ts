import QRCode from "qrcode";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, conflict, json, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { decrypt, encrypt } from "@/lib/auth/crypto";
import { homePathFor, issueRecoveryCodes } from "@/lib/auth/flows";
import { rateLimit } from "@/lib/auth/rate-limit";
import { getAuth, markSessionMfaVerified, requestMeta } from "@/lib/auth/session";
import { generateTotpSecret, otpauthUri, verifyTotp } from "@/lib/auth/totp";
import { sendEmail } from "@/lib/email/send";
import { mfaNotificationEmail } from "@/lib/email/templates";

/**
 * MFA enrolment. Allowed for a signed-in user whose session is waiting on MFA
 * setup, or a fully signed-in user enabling MFA voluntarily.
 */
async function requireEnrolmentSession() {
  const auth = await getAuth();
  if (!auth) throw new ApiError(401, "Sign in required", "UNAUTHENTICATED");
  if (auth.user.mfaEnabled) throw conflict("Multi-factor authentication is already enabled.");
  return auth;
}

export const GET = route(async () => {
  const auth = await requireEnrolmentSession();
  // Reuse a pending (not yet enabled) secret so repeated loads show the same QR code.
  const pending = await prisma.mfaCredential.findUnique({ where: { userId: auth.user.id } });
  let secret: string;
  if (pending && !pending.enabledAt) {
    secret = decrypt(pending.secretEncrypted);
  } else {
    secret = generateTotpSecret();
    await prisma.mfaCredential.upsert({
      where: { userId: auth.user.id },
      create: { userId: auth.user.id, secretEncrypted: encrypt(secret) },
      update: { secretEncrypted: encrypt(secret), enabledAt: null, lastUsedStep: null },
    });
  }
  const uri = otpauthUri(secret, auth.user.email);
  const qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 220, errorCorrectionLevel: "M" });
  return json({ secret, otpauthUri: uri, qrDataUrl });
});

const schema = z.object({ code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code") });

export const POST = route(async (req) => {
  const auth = await requireEnrolmentSession();
  const { code } = await parseBody(req, schema);
  const limit = await rateLimit(`mfa-setup:${auth.session.id}`, 10, 10 * 60);
  if (!limit.allowed) throw new ApiError(429, "Too many attempts. Wait a few minutes.", "RATE_LIMITED");

  const cred = await prisma.mfaCredential.findUnique({ where: { userId: auth.user.id } });
  if (!cred) throw new ApiError(400, "Start the setup again to get a new QR code.", "NO_PENDING_SECRET");
  const step = verifyTotp(decrypt(cred.secretEncrypted), code);
  if (step === null) throw new ApiError(400, "That code did not match. Make sure your device time is correct and try again.", "INVALID_CODE");

  await prisma.mfaCredential.update({ where: { id: cred.id }, data: { enabledAt: new Date(), lastUsedStep: step } });
  const recoveryCodes = await issueRecoveryCodes(auth.user.id);
  await markSessionMfaVerified(auth.session.id);

  const meta = await requestMeta();
  await audit(prisma, { actor: { id: auth.user.id, name: auth.user.name, email: auth.user.email }, entityType: "USER", entityId: auth.user.id, action: "MFA_ENABLED", ip: meta.ip, userAgent: meta.userAgent });
  await sendEmail({ to: auth.user.email, toName: auth.user.name, ...mfaNotificationEmail({ name: auth.user.name, event: "enabled" }), template: "MFA_NOTIFICATION", userId: auth.user.id });

  return json({ recoveryCodes, next: await homePathFor(auth.user, auth.session.activeWorkspaceId) });
});
