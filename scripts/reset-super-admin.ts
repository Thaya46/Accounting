/**
 * Recovery tool: sets the Super Admin's email and password from
 * SEED_SUPER_ADMIN_EMAIL / SEED_SUPER_ADMIN_PASSWORD, clears their MFA
 * enrolment (they re-enrol at next sign-in) and signs out all their sessions.
 *   npm run superadmin:reset
 * If several Super Admins exist, pass the current email: npm run superadmin:reset -- old@email
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth/password";
import { audit } from "../src/lib/audit";

async function main() {
  const email = (process.env.SEED_SUPER_ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.SEED_SUPER_ADMIN_PASSWORD ?? "";
  if (!email || !password) throw new Error("Set SEED_SUPER_ADMIN_EMAIL and SEED_SUPER_ADMIN_PASSWORD in .env");

  const current = process.argv[2]?.toLowerCase();
  const admins = await prisma.user.findMany({ where: { platformRole: "SUPER_ADMIN", ...(current ? { email: current } : {}) } });
  const target = admins.find((a) => a.email === email) ?? (admins.length === 1 ? admins[0] : null);
  if (!target && admins.length > 1) throw new Error(`Several Super Admins exist (${admins.map((a) => a.email).join(", ")}). Pass the one to update.`);

  const clash = await prisma.user.findUnique({ where: { email } });
  if (clash && clash.id !== target?.id) throw new Error(`${email} already belongs to another (non Super Admin) account.`);

  const passwordHash = await hashPassword(password);
  const user = target
    ? await prisma.user.update({ where: { id: target.id }, data: { email, passwordHash, status: "ACTIVE", failedLoginCount: 0, lockedUntil: null } })
    : await prisma.user.create({ data: { email, name: "Super Admin", passwordHash, platformRole: "SUPER_ADMIN", status: "ACTIVE", emailVerifiedAt: new Date() } });

  await prisma.$transaction([
    prisma.mfaCredential.deleteMany({ where: { userId: user.id } }),
    prisma.recoveryCode.deleteMany({ where: { userId: user.id } }),
    prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  await audit(prisma, {
    actor: { id: null, name: "System (reset-super-admin script)" },
    entityType: "USER",
    entityId: user.id,
    action: "SUPER_ADMIN_CREDENTIALS_RESET",
    before: target ? { email: target.email } : undefined,
    after: { email, mfaReset: true, sessionsRevoked: true },
  });
  console.log(`✔ Super Admin is now ${email}. MFA was reset — enrol an authenticator app at next sign-in.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
