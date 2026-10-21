import { Prisma } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodTypeAny, type z } from "zod";
import type { PermissionKey } from "@/lib/permissions";
import { getAuth, requestMeta, type AuthUser } from "@/lib/auth/session";
import { loadWorkspaceContext, type WorkspaceContext } from "@/lib/auth/workspace";

import { ApiError, badRequest, forbidden } from "@/lib/errors";

export { ApiError, badRequest, conflict, forbidden, notFound } from "@/lib/errors";

type RouteParams = { params: Promise<Record<string, string>> };
type Handler = (req: NextRequest, params: Record<string, string>) => Promise<Response>;

/**
 * Wraps a route handler: same-origin check for mutations, consistent JSON
 * errors, and Zod / Prisma error translation.
 */
export function route(handler: Handler) {
  return async (req: NextRequest, ctx: RouteParams) => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        const origin = req.headers.get("origin");
        if (origin) {
          const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
          if (new URL(origin).host !== host) throw forbidden("Cross-origin request rejected");
        }
      }
      const params = (await ctx?.params) ?? {};
      return await handler(req, params);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function errorResponse(err: unknown) {
  if (err instanceof ApiError) {
    return NextResponse.json({ error: { code: err.code, message: err.message, details: err.details } }, { status: err.status });
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: err.issues[0]?.message ?? "Invalid input", details: err.flatten() } },
      { status: 422 },
    );
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return NextResponse.json({ error: { code: "CONFLICT", message: "A record with these details already exists." } }, { status: 409 });
    }
    if (err.code === "P2025") {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Record not found." } }, { status: 404 });
    }
  }
  const message = err instanceof Error ? err.message : String(err);
  if (/journal entry .* not balanced|append-only|immutable/i.test(message)) {
    return NextResponse.json({ error: { code: "INTEGRITY_ERROR", message } }, { status: 422 });
  }
  console.error("[api] Unhandled error", err);
  return NextResponse.json({ error: { code: "INTERNAL", message: "Something went wrong. Please try again." } }, { status: 500 });
}

export function json<T>(data: T, init?: number | ResponseInit) {
  return NextResponse.json(data, typeof init === "number" ? { status: init } : init);
}

export async function parseBody<S extends ZodTypeAny>(req: NextRequest, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw badRequest("Request body must be valid JSON");
  }
  return schema.parse(body);
}

export function parseQuery<S extends ZodTypeAny>(req: NextRequest, schema: S): z.infer<S> {
  return schema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
}

/** API auth: signed in, MFA step complete. */
export async function apiAuth(): Promise<{ user: AuthUser; sessionId: string }> {
  const auth = await getAuth();
  if (!auth) throw new ApiError(401, "Sign in required", "UNAUTHENTICATED");
  if (!auth.session.mfaVerified) throw new ApiError(403, "Multi-factor authentication required", "MFA_REQUIRED");
  return { user: auth.user, sessionId: auth.session.id };
}

export async function apiSuperAdmin() {
  const auth = await apiAuth();
  if (auth.user.platformRole !== "SUPER_ADMIN") throw forbidden();
  return auth;
}

/**
 * API workspace guard — enforces membership, workspace status and permission on
 * the server. Requests for a workspace the caller does not belong to get 403.
 */
export async function apiWorkspace(workspaceId: string, permission?: PermissionKey | PermissionKey[]): Promise<WorkspaceContext & { meta: { ip: string; userAgent: string } }> {
  const { user } = await apiAuth();
  const result = await loadWorkspaceContext(user, workspaceId);
  if (!result.ok) {
    throw result.error === "INACTIVE" ? forbidden("This workspace is not active") : forbidden("Access denied");
  }
  const needed = permission ? (Array.isArray(permission) ? permission : [permission]) : [];
  if (needed.length && !needed.some((p) => result.ctx.permissions.has(p))) {
    throw forbidden(`Missing permission: ${needed.join(" or ")}`);
  }
  return { ...result.ctx, meta: await requestMeta() };
}

export function requirePermission(ctx: WorkspaceContext, permission: PermissionKey) {
  if (!ctx.permissions.has(permission)) throw forbidden(`Missing permission: ${permission}`);
}
