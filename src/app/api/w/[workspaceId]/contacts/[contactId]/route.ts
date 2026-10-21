import { apiWorkspace, json, parseBody, route } from "@/lib/api";
import { contactUpdateSchema, parseContactKind, updateContact } from "@/lib/workspace-admin/contacts";

/** PATCH ?kind=customer|vendor — Body: any of { name, email, phone, taxId } */
export const PATCH = route(async (req, { workspaceId, contactId }) => {
  const ctx = await apiWorkspace(workspaceId, "ACCOUNTS_MANAGE");
  const kind = parseContactKind(req.nextUrl.searchParams.get("kind"));
  const body = await parseBody(req, contactUpdateSchema);
  return json({ contact: await updateContact(ctx, kind, contactId!, body) });
});
