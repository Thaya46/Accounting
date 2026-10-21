import { z } from "zod";
import { ApiError, json, parseBody, route } from "@/lib/api";
import { rateLimit } from "@/lib/auth/rate-limit";
import { createSession, isMfaRequired, requestMeta } from "@/lib/auth/session";
import { homePathFor } from "@/lib/auth/flows";
import { acceptInvitation } from "@/lib/workspaces/invitations";

const schema = z.object({
  token: z.string().min(20).max(200),
  name: z.string().trim().min(2).max(120),
  password: z.string().min(1).max(200),
});

export const POST = route(async (req) => {
  const body = await parseBody(req, schema);
  const meta = await requestMeta();
  const limit = await rateLimit(`invite:${meta.ip}`, 20, 15 * 60);
  if (!limit.allowed) throw new ApiError(429, "Too many attempts. Try again later.", "RATE_LIMITED");

  const { user, workspaceId } = await acceptInvitation(body.token, { name: body.name, password: body.password }, meta);

  const mfaRequired = await isMfaRequired(user.id);
  await createSession(user.id, { mfaVerified: !user.mfaEnabled && !mfaRequired, activeWorkspaceId: workspaceId });
  const next = user.mfaEnabled ? "/mfa" : mfaRequired ? "/setup-mfa" : await homePathFor(user, workspaceId);
  return json({ next });
});
