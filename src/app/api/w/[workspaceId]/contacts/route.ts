import { apiWorkspace, json, parseBody, route } from "@/lib/api";
import { contactCreateSchema, createContact, listContacts, parseContactKind } from "@/lib/workspace-admin/contacts";

/** GET ?kind=customer|vendor — contacts with transaction counts. */
export const GET = route(async (req, { workspaceId }) => {
  const ctx = await apiWorkspace(workspaceId, "ACCOUNTS_MANAGE");
  const kind = parseContactKind(req.nextUrl.searchParams.get("kind"));
  return json({ kind, contacts: await listContacts(ctx.workspace.id, kind) });
});

/** POST ?kind=customer|vendor — Body: { name, email?, phone?, taxId? } */
export const POST = route(async (req, { workspaceId }) => {
  const ctx = await apiWorkspace(workspaceId, "ACCOUNTS_MANAGE");
  const kind = parseContactKind(req.nextUrl.searchParams.get("kind"));
  const body = await parseBody(req, contactCreateSchema);
  return json({ contact: await createContact(ctx, kind, body) }, 201);
});
