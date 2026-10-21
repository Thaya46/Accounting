/** Export request schema and period helpers. Pure — shared by API routes and client components. */
import { z } from "zod";
import { ADAPTER_CATALOG, type AdapterKey } from "./adapter-keys";
import { EXPORT_TYPES } from "./canonical-schema";
import { financialYearRange, parseISODate } from "@/lib/dates";

const ADAPTER_KEYS = ADAPTER_CATALOG.map((a) => a.key) as [AdapterKey, ...AdapterKey[]];
export const TXN_TYPES = ["INCOME", "EXPENSE", "TRANSFER", "JOURNAL"] as const;
export const TXN_STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "POSTED", "REVERSED", "REJECTED"] as const;
export const POSTED_STATUSES = ["POSTED", "REVERSED"] as const;
export const MAX_EXPORT_TRANSACTIONS = 20_000;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const periodSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fy"), startYear: z.number().int().min(1990).max(2200) }),
  z.object({ kind: z.literal("custom"), from: day, to: day }),
]);
export type Period = z.infer<typeof periodSchema>;

export const exportRequestSchema = z.object({
  adapterKey: z.enum(ADAPTER_KEYS),
  exportType: z.enum(EXPORT_TYPES).default("accounting_transactions"),
  period: periodSchema,
  types: z.array(z.enum(TXN_TYPES)).max(4).default([]),
  statuses: z.array(z.enum(TXN_STATUSES)).min(1, "Choose at least one status").max(6).default(["POSTED", "REVERSED"]),
  createdById: z.string().trim().min(1).max(64).nullish(),
  categoryIds: z.array(z.string().min(1).max(64)).max(200).default([]),
  accountIds: z.array(z.string().min(1).max(64)).max(500).default([]),
  excludeAlreadyExported: z.boolean().default(false),
  includeAuditTrail: z.boolean().default(true),
});
export type ExportRequest = z.infer<typeof exportRequestSchema>;
export type ExportRequestInput = z.input<typeof exportRequestSchema>;

/** Resolves a period to an inclusive date range. Throws on invalid or inverted ranges. */
export function resolvePeriod(period: Period, fyStartMonth: number): { from: string; to: string; label: string | null } {
  if (period.kind === "fy") {
    const fy = financialYearRange(period.startYear, fyStartMonth);
    return { from: fy.from, to: fy.to, label: fy.label };
  }
  const from = parseISODate(period.from);
  const to = parseISODate(period.to);
  if (to < from) throw new RangeError("The end date must be on or after the start date.");
  const years = (to.getTime() - from.getTime()) / (365.25 * 86_400_000);
  if (years > 10) throw new RangeError("Choose a range of at most 10 years.");
  return { from: period.from, to: period.to, label: null };
}
