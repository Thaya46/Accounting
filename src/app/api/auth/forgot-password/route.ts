import { z } from "zod";
import { prisma } from "@/lib/db";
import { json, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { randomToken, sha256 } from "@/lib/auth/crypto";
import { rateLimit } from "@/lib/auth/rate-limit";
import { requestMeta } from "@/lib/auth/session";
import { sendEmail } from "@/lib/email/send";
import { passwordResetEmail } from "@/lib/email/templates";

const schema = z.object({ email: z.string().trim().toLowerCase().email().max(200) });
const TTL_MINUTES = 30;

/** Always answers the same way so the endpoint cannot be used to discover accounts. */
export const POST = route(async (req) => {
  const { email } = await parseBody(req, schema);
  const meta = await requestMeta();
  const generic = json({ ok: true, message: "If an active account exists for that email, a reset link is on its way." });

  const ipLimit = await rateLimit(`reset:ip:${meta.ip}`, 10, 60 * 60);
  const emailLimit = await rateLimit(`reset:email:${email}`, 3, 60 * 60);
  if (!ipLimit.allowed || !emailLimit.allowed) return generic;

  const settings = await prisma.platformSettings.findUnique({ where: { id: "platform" } });
  if (settings && !settings.allowSelfPasswordReset) return generic;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.status !== "ACTIVE" || !user.passwordHash) return generic;

  const token = randomToken(32);
  await prisma.authToken.updateMany({ where: { userId: user.id, type: "PASSWORD_RESET", usedAt: null }, data: { usedAt: new Date() } });
  await prisma.authToken.create({
    data: { userId: user.id, type: "PASSWORD_RESET", tokenHash: sha256(token), expiresAt: new Date(Date.now() + TTL_MINUTES * 60_000) },
  });
  await audit(prisma, { actor: { id: user.id, name: user.name, email: user.email }, entityType: "USER", entityId: user.id, action: "PASSWORD_RESET_REQUESTED", ip: meta.ip, userAgent: meta.userAgent });
  await sendEmail({ to: user.email, toName: user.name, ...passwordResetEmail({ name: user.name, token, expiresMinutes: TTL_MINUTES }), template: "PASSWORD_RESET", userId: user.id });
  return generic;
});
