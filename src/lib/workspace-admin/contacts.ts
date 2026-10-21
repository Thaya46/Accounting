import { z } from "zod";
import { prisma, type Tx } from "@/lib/db";
import { audit, diff } from "@/lib/audit";
import { badRequest, conflict, notFound } from "@/lib/errors";
import { CONTACT_KINDS, type ContactKind } from "./constants";
import { TX_OPTIONS, auditMeta, optionalText, type AdminCtx } from "./common";

export type ContactRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  taxId: string | null;
  transactionCount: number;
  createdAt: string;
};

export function parseContactKind(value: string | null | undefined): ContactKind {
  if (value && (CONTACT_KINDS as readonly string[]).includes(value)) return value as ContactKind;
  throw badRequest("Query parameter kind must be 'customer' or 'vendor'");
}

const select = { id: true, name: true, email: true, phone: true, taxId: true, createdAt: true, _count: { select: { transactions: true } } } as const;

type RawContact = { id: string; name: string; email: string | null; phone: string | null; taxId: string | null; createdAt: Date; _count: { transactions: number } };

function toRow(c: RawContact): ContactRow {
  return { id: c.id, name: c.name, email: c.email, phone: c.phone, taxId: c.taxId, transactionCount: c._count.transactions, createdAt: c.createdAt.toISOString() };
}

export async function listContacts(workspaceId: string, kind: ContactKind): Promise<ContactRow[]> {
  const rows: RawContact[] =
    kind === "customer"
      ? await prisma.customer.findMany({ where: { workspaceId }, select, orderBy: { name: "asc" } })
      : await prisma.vendor.findMany({ where: { workspaceId }, select, orderBy: { name: "asc" } });
  return rows.map(toRow);
}

const phoneSchema = optionalText(40).refine((v) => v === null || /^[0-9+()\-.\s]{4,40}$/.test(v), "Enter a valid phone number");
const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || z.string().email().safeParse(v).success, "Enter a valid email address");

export const contactCreateSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(160),
  email: emailSchema,
  phone: phoneSchema,
  taxId: optionalText(40),
});

export const contactUpdateSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(160).optional(),
  email: emailSchema.optional(),
  phone: phoneSchema.optional(),
  taxId: optionalText(40).optional(),
});

type ContactData = { name: string; email: string | null; phone: string | null; taxId: string | null };

async function findContact(db: Tx, kind: ContactKind, workspaceId: string, id: string) {
  return kind === "customer"
    ? db.customer.findFirst({ where: { id, workspaceId }, select })
    : db.vendor.findFirst({ where: { id, workspaceId }, select });
}

async function assertNameFree(db: Tx, kind: ContactKind, workspaceId: string, name: string, exceptId?: string) {
  const where = { workspaceId, name: { equals: name, mode: "insensitive" as const }, ...(exceptId ? { id: { not: exceptId } } : {}) };
  const clash = kind === "customer" ? await db.customer.findFirst({ where, select: { id: true } }) : await db.vendor.findFirst({ where, select: { id: true } });
  if (clash) throw conflict(`A ${kind} named "${name}" already exists`);
}

export async function createContact(ctx: AdminCtx, kind: ContactKind, body: ContactData) {
  return prisma.$transaction(async (tx) => {
    await assertNameFree(tx, kind, ctx.workspace.id, body.name);
    const data = { workspaceId: ctx.workspace.id, ...body };
    const created = kind === "customer" ? await tx.customer.create({ data, select }) : await tx.vendor.create({ data, select });
    await audit(tx, {
      ...auditMeta(ctx),
      entityType: kind === "customer" ? "CUSTOMER" : "VENDOR",
      entityId: created.id,
      action: kind === "customer" ? "CUSTOMER_CREATED" : "VENDOR_CREATED",
      after: body,
    });
    return toRow(created);
  }, TX_OPTIONS);
}

export async function updateContact(ctx: AdminCtx, kind: ContactKind, id: string, body: Partial<ContactData>) {
  return prisma.$transaction(async (tx) => {
    const existing = await findContact(tx, kind, ctx.workspace.id, id);
    if (!existing) throw notFound(`${kind === "customer" ? "Customer" : "Vendor"} not found`);
    const current: ContactData = { name: existing.name, email: existing.email, phone: existing.phone, taxId: existing.taxId };
    const next: ContactData = {
      name: body.name ?? current.name,
      email: body.email !== undefined ? body.email : current.email,
      phone: body.phone !== undefined ? body.phone : current.phone,
      taxId: body.taxId !== undefined ? body.taxId : current.taxId,
    };
    if (next.name.toLowerCase() !== current.name.toLowerCase()) await assertNameFree(tx, kind, ctx.workspace.id, next.name, id);
    const d = diff(current, next);
    if (!d.changed) return toRow(existing);
    const updated =
      kind === "customer"
        ? await tx.customer.update({ where: { id: existing.id }, data: next, select })
        : await tx.vendor.update({ where: { id: existing.id }, data: next, select });
    await audit(tx, {
      ...auditMeta(ctx),
      entityType: kind === "customer" ? "CUSTOMER" : "VENDOR",
      entityId: existing.id,
      action: kind === "customer" ? "CUSTOMER_UPDATED" : "VENDOR_UPDATED",
      before: { contact: current.name, ...d.before },
      after: { contact: next.name, ...d.after },
    });
    return toRow(updated);
  }, TX_OPTIONS);
}
