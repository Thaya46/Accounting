import { prisma } from "@/lib/db";
import { userRef } from "@/lib/ids";
import type { AuthUser } from "@/lib/auth/session";

/** Props for the shared Profile panel. */
export async function loadProfile(user: AuthUser) {
  const memberships = await prisma.workspaceMembership.findMany({
    where: { userId: user.id },
    include: { workspace: { select: { name: true, code: true } }, role: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return {
    user: { name: user.name, email: user.email, ref: userRef(user.seq), platformRole: user.platformRole },
    memberships: memberships.map((m) => ({
      workspaceName: m.workspace.name,
      workspaceCode: m.workspace.code,
      role: m.role.name,
      status: m.status,
      employeeId: m.employeeId,
      department: m.department,
    })),
  };
}
