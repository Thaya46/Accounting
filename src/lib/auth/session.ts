import { cookies, headers } from "next/headers";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { randomToken, sha256 } from "./crypto";
import { secureCookieFor } from "./secure-cookie";

export const SESSION_COOKIE = "vl_session";

export type AuthUser = {
  id: string;
  seq: number;
  email: string;
  name: string;
  platformRole: "SUPER_ADMIN" | "USER";
  status: "PENDING" | "ACTIVE" | "DISABLED";
  mfaEnabled: boolean;
};

export type AuthSession = {
  id: string;
  mfaVerified: boolean;
  activeWorkspaceId: string | null;
  expiresAt: Date;
};

export async function requestMeta() {
  const h = await headers();
  const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "local").trim();
  return { ip, userAgent: h.get("user-agent") ?? "" };
}

async function sessionTtlHours() {
  const settings = await prisma.platformSettings.findUnique({ where: { id: "platform" } });
  return settings?.sessionTtlHours ?? 12;
}

/** Creates a server-side session and sets the httpOnly cookie. Only the token hash is stored. */
export async function createSession(userId: string, opts: { mfaVerified: boolean; activeWorkspaceId?: string | null }) {
  const token = randomToken(32);
  const { ip, userAgent } = await requestMeta();
  const ttl = await sessionTtlHours();
  const expiresAt = new Date(Date.now() + ttl * 3600 * 1000);
  const session = await prisma.session.create({
    data: {
      tokenHash: sha256(token),
      userId,
      mfaVerified: opts.mfaVerified,
      activeWorkspaceId: opts.activeWorkspaceId ?? null,
      ip,
      userAgent: userAgent.slice(0, 400),
      expiresAt,
    },
  });
  const jar = await cookies();
  const h = await headers();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookieFor(h.get("x-forwarded-proto"), env.cookieSecure, env.isProduction),
    path: "/",
    expires: expiresAt,
  });
  return session;
}

/** Reads and validates the current session (memoised per request). */
export const getAuth = cache(async (): Promise<{ user: AuthUser; session: AuthSession } | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { include: { mfaCredential: { select: { enabledAt: true } } } } },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  if (session.user.status === "DISABLED") return null;

  // Sliding activity timestamp, written at most once a minute.
  if (Date.now() - session.lastSeenAt.getTime() > 60_000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
  const u = session.user;
  return {
    user: {
      id: u.id,
      seq: u.seq,
      email: u.email,
      name: u.name,
      platformRole: u.platformRole,
      status: u.status,
      mfaEnabled: Boolean(u.mfaCredential?.enabledAt),
    },
    session: {
      id: session.id,
      mfaVerified: session.mfaVerified,
      activeWorkspaceId: session.activeWorkspaceId,
      expiresAt: session.expiresAt,
    },
  };
});

export async function markSessionMfaVerified(sessionId: string) {
  await prisma.session.update({ where: { id: sessionId }, data: { mfaVerified: true } });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.updateMany({ where: { tokenHash: sha256(token) }, data: { revokedAt: new Date() } });
  }
  jar.delete(SESSION_COOKIE);
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string) {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { NOT: { id: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
}

/** Whether policy requires this user to use MFA (admins always do). */
export async function isMfaRequired(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      platformRole: true,
      memberships: {
        where: { status: "ACTIVE" },
        select: { role: { select: { isAdmin: true } }, workspace: { select: { settings: { select: { mfaRequiredForUsers: true } } } } },
      },
    },
  });
  if (!user) return true;
  if (user.platformRole === "SUPER_ADMIN") return true;
  if (user.memberships.some((m) => m.role.isAdmin || m.workspace.settings?.mfaRequiredForUsers)) return true;
  const platform = await prisma.platformSettings.findUnique({ where: { id: "platform" } });
  return Boolean(platform?.requireMfaForUsers);
}
