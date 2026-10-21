import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiAuth, json, parseBody, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requestMeta } from "@/lib/auth/session";

/** Current user's profile. */
export const GET = route(async () => {
  const { user } = await apiAuth();
  const memberships = await prisma.workspaceMembership.findMany({
    where: { userId: user.id },
    include: { workspace: { select: { id: true, name: true, code: true, status: true } }, role: { select: { name: true } } },
  });
  return json({
    user,
    memberships: memberships.map((m) => ({
      workspace: m.workspace,
      role: m.role.name,
      status: m.status,
      employeeId: m.employeeId,
      department: m.department,
    })),
  });
});

const patchSchema = z.object({ name: z.string().trim().min(2).max(120) });

export const PATCH = route(async (req) => {
  const { user } = await apiAuth();
  const { name } = await parseBody(req, patchSchema);
  const meta = await requestMeta();
  await prisma.user.update({ where: { id: user.id }, data: { name } });
  await audit(prisma, {
    actor: { id: user.id, name, email: user.email },
    entityType: "USER",
    entityId: user.id,
    action: "PROFILE_UPDATED",
    before: { name: user.name },
    after: { name },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  return json({ ok: true });
});
