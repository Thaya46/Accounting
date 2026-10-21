import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { sha256 } from "./crypto";

/** Where a fully authenticated user lands. */
export async function homePathFor(user: { id: string; platformRole: string }, preferredWorkspaceId?: string | null) {
  if (user.platformRole === "SUPER_ADMIN") return "/admin";
  const memberships = await prisma.workspaceMembership.findMany({
    where: { userId: user.id, status: "ACTIVE", workspace: { status: "ACTIVE" } },
    select: { workspaceId: true },
    orderBy: { createdAt: "asc" },
  });
  const pick = memberships.find((m) => m.workspaceId === preferredWorkspaceId) ?? memberships[0];
  return pick ? `/w/${pick.workspaceId}/dashboard` : "/access-denied?reason=no-workspace";
}

/** Generates human-friendly single-use recovery codes ("k3f9a-7dq2m"). Returns plaintext codes; stores hashes. */
export async function issueRecoveryCodes(userId: string, count = 10) {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const codes = Array.from({ length: count }, () => {
    const bytes = crypto.randomBytes(10);
    const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
  await prisma.$transaction([
    prisma.recoveryCode.deleteMany({ where: { userId } }),
    prisma.recoveryCode.createMany({ data: codes.map((c) => ({ userId, codeHash: sha256(normalizeRecoveryCode(c)) })) }),
  ]);
  return codes;
}

export function normalizeRecoveryCode(code: string) {
  return code.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Consumes a recovery code atomically. Returns true when a valid unused code was used. */
export async function consumeRecoveryCode(userId: string, code: string) {
  const hash = sha256(normalizeRecoveryCode(code));
  const result = await prisma.recoveryCode.updateMany({ where: { userId, codeHash: hash, usedAt: null }, data: { usedAt: new Date() } });
  return result.count === 1;
}
