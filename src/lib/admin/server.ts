import { Prisma } from "@prisma/client";
import { ApiError, apiSuperAdmin, badRequest } from "@/lib/api";
import { requestMeta } from "@/lib/auth/session";
import type { Actor } from "@/lib/audit";

/** Super Admin API guard plus the attribution snapshot and request metadata used for auditing. */
export async function adminApi() {
  const { user } = await apiSuperAdmin();
  const actor: Actor & { id: string; name: string; email: string } = { id: user.id, name: user.name, email: user.email };
  const meta = await requestMeta();
  return { user, actor, meta };
}

/**
 * createInvitation() signals business-rule violations with plain Errors
 * (e.g. "Super Admin accounts cannot join workspaces"). Convert those to 400s;
 * anything else (Prisma, ApiError, …) is rethrown for route() to handle.
 */
export function toInvitationError(err: unknown): unknown {
  if (err instanceof ApiError) return err;
  if (err instanceof Prisma.PrismaClientKnownRequestError || err instanceof Prisma.PrismaClientUnknownRequestError) return err;
  if (err instanceof Error && /super admin|already an active member|role does not belong/i.test(err.message)) {
    return badRequest(err.message);
  }
  return err;
}

export async function withInvitationErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw toInvitationError(err);
  }
}
