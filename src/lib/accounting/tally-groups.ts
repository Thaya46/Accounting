import { prisma } from "@/lib/db";
import type { AccountType } from "@prisma/client";

export type StandardGroupDef = {
  name: string;
  code: string;
  parentName?: string;
  nature: AccountType;
  isPrimary: boolean;
  affectsGrossProfit: boolean;
  sortOrder: number;
};

export const STANDARD_TALLY_GROUPS: StandardGroupDef[] = [
  // ── 15 Primary Groups ──
  { name: "Capital Account", code: "GRP-CAP", nature: "EQUITY", isPrimary: true, affectsGrossProfit: false, sortOrder: 10 },
  { name: "Loans (Liability)", code: "GRP-LOAN", nature: "LIABILITY", isPrimary: true, affectsGrossProfit: false, sortOrder: 20 },
  { name: "Current Liabilities", code: "GRP-CL", nature: "LIABILITY", isPrimary: true, affectsGrossProfit: false, sortOrder: 30 },
  { name: "Fixed Assets", code: "GRP-FA", nature: "ASSET", isPrimary: true, affectsGrossProfit: false, sortOrder: 40 },
  { name: "Investments", code: "GRP-INV", nature: "ASSET", isPrimary: true, affectsGrossProfit: false, sortOrder: 50 },
  { name: "Current Assets", code: "GRP-CA", nature: "ASSET", isPrimary: true, affectsGrossProfit: false, sortOrder: 60 },
  { name: "Branch / Divisions", code: "GRP-BR", nature: "LIABILITY", isPrimary: true, affectsGrossProfit: false, sortOrder: 70 },
  { name: "Suspense A/c", code: "GRP-SUSP", nature: "LIABILITY", isPrimary: true, affectsGrossProfit: false, sortOrder: 80 },
  { name: "Misc. Expenses (ASSET)", code: "GRP-MISC-EXP", nature: "ASSET", isPrimary: true, affectsGrossProfit: false, sortOrder: 90 },

  // Trading Account Groups (Affects Gross Profit)
  { name: "Sales Accounts", code: "GRP-SALES", nature: "INCOME", isPrimary: true, affectsGrossProfit: true, sortOrder: 100 },
  { name: "Purchase Accounts", code: "GRP-PURCH", nature: "EXPENSE", isPrimary: true, affectsGrossProfit: true, sortOrder: 110 },
  { name: "Direct Incomes", code: "GRP-DIR-INC", nature: "INCOME", isPrimary: true, affectsGrossProfit: true, sortOrder: 120 },
  { name: "Direct Expenses", code: "GRP-DIR-EXP", nature: "EXPENSE", isPrimary: true, affectsGrossProfit: true, sortOrder: 130 },

  // Profit & Loss Account Groups (Affects Net Profit)
  { name: "Indirect Incomes", code: "GRP-INDIR-INC", nature: "INCOME", isPrimary: true, affectsGrossProfit: false, sortOrder: 140 },
  { name: "Indirect Expenses", code: "GRP-INDIR-EXP", nature: "EXPENSE", isPrimary: true, affectsGrossProfit: false, sortOrder: 150 },

  // ── 13 Secondary / Sub-Groups ──
  { name: "Reserves & Surplus", code: "GRP-RES", parentName: "Capital Account", nature: "EQUITY", isPrimary: false, affectsGrossProfit: false, sortOrder: 11 },
  { name: "Secured Loans", code: "GRP-SECLOAN", parentName: "Loans (Liability)", nature: "LIABILITY", isPrimary: false, affectsGrossProfit: false, sortOrder: 21 },
  { name: "Unsecured Loans", code: "GRP-UNSECLOAN", parentName: "Loans (Liability)", nature: "LIABILITY", isPrimary: false, affectsGrossProfit: false, sortOrder: 22 },
  { name: "Bank OD A/c", code: "GRP-BANKOD", parentName: "Loans (Liability)", nature: "LIABILITY", isPrimary: false, affectsGrossProfit: false, sortOrder: 23 },

  { name: "Duties & Taxes", code: "GRP-DUTIES", parentName: "Current Liabilities", nature: "LIABILITY", isPrimary: false, affectsGrossProfit: false, sortOrder: 31 },
  { name: "Provisions", code: "GRP-PROV", parentName: "Current Liabilities", nature: "LIABILITY", isPrimary: false, affectsGrossProfit: false, sortOrder: 32 },
  { name: "Sundry Creditors", code: "GRP-CRED", parentName: "Current Liabilities", nature: "LIABILITY", isPrimary: false, affectsGrossProfit: false, sortOrder: 33 },

  { name: "Sundry Debtors", code: "GRP-DEBT", parentName: "Current Assets", nature: "ASSET", isPrimary: false, affectsGrossProfit: false, sortOrder: 61 },
  { name: "Bank Accounts", code: "GRP-BANK", parentName: "Current Assets", nature: "ASSET", isPrimary: false, affectsGrossProfit: false, sortOrder: 62 },
  { name: "Cash-in-Hand", code: "GRP-CASH", parentName: "Current Assets", nature: "ASSET", isPrimary: false, affectsGrossProfit: false, sortOrder: 63 },
  { name: "Deposits (Asset)", code: "GRP-DEP", parentName: "Current Assets", nature: "ASSET", isPrimary: false, affectsGrossProfit: false, sortOrder: 64 },
  { name: "Loans & Advances (Asset)", code: "GRP-LOANADV", parentName: "Current Assets", nature: "ASSET", isPrimary: false, affectsGrossProfit: false, sortOrder: 65 },
  { name: "Stock-in-Hand", code: "GRP-STOCK", parentName: "Current Assets", nature: "ASSET", isPrimary: false, affectsGrossProfit: false, sortOrder: 66 },
];

/** Ensures the 28 Tally groups exist in the specified workspace and maps unassigned accounts. */
export async function ensureTallyGroups(workspaceId: string) {
  const existing = await prisma.accountGroup.findMany({
    where: { workspaceId },
  });

  const byName = new Map(existing.map((g) => [g.name.toLowerCase(), g]));

  // First pass: create primaries
  for (const def of STANDARD_TALLY_GROUPS.filter((g) => g.isPrimary)) {
    if (!byName.has(def.name.toLowerCase())) {
      const created = await prisma.accountGroup.create({
        data: {
          workspaceId,
          name: def.name,
          code: def.code,
          nature: def.nature,
          isPrimary: true,
          affectsGrossProfit: def.affectsGrossProfit,
          sortOrder: def.sortOrder,
        },
      });
      byName.set(def.name.toLowerCase(), created);
    }
  }

  // Second pass: create sub-groups with parent pointers
  for (const def of STANDARD_TALLY_GROUPS.filter((g) => !g.isPrimary)) {
    if (!byName.has(def.name.toLowerCase())) {
      const parent = def.parentName ? byName.get(def.parentName.toLowerCase()) : null;
      const created = await prisma.accountGroup.create({
        data: {
          workspaceId,
          name: def.name,
          code: def.code,
          parentGroupId: parent?.id ?? null,
          nature: def.nature,
          isPrimary: false,
          affectsGrossProfit: def.affectsGrossProfit,
          sortOrder: def.sortOrder,
        },
      });
      byName.set(def.name.toLowerCase(), created);
    }
  }

  // Map any accounts that don't have a group assigned yet
  const unassigned = await prisma.account.findMany({
    where: { workspaceId, groupId: null },
  });

  for (const acc of unassigned) {
    let targetGroupName = "Indirect Expenses";
    if (acc.type === "INCOME") {
      targetGroupName = acc.code.includes("SALES") ? "Sales Accounts" : "Indirect Incomes";
    } else if (acc.type === "EXPENSE") {
      targetGroupName = acc.code.includes("PURCH") ? "Purchase Accounts" : "Indirect Expenses";
    } else if (acc.type === "ASSET") {
      if (acc.subtype === "BANK") targetGroupName = "Bank Accounts";
      else if (acc.subtype === "CASH" || acc.subtype === "WALLET") targetGroupName = "Cash-in-Hand";
      else if (acc.subtype === "RECEIVABLE") targetGroupName = "Sundry Debtors";
      else if (acc.subtype === "FIXED_ASSET") targetGroupName = "Fixed Assets";
      else targetGroupName = "Current Assets";
    } else if (acc.type === "LIABILITY") {
      if (acc.subtype === "PAYABLE") targetGroupName = "Sundry Creditors";
      else if (acc.subtype === "TAX") targetGroupName = "Duties & Taxes";
      else if (acc.subtype === "LOAN") targetGroupName = "Secured Loans";
      else targetGroupName = "Current Liabilities";
    } else if (acc.type === "EQUITY") {
      targetGroupName = "Capital Account";
    }

    const g = byName.get(targetGroupName.toLowerCase());
    if (g) {
      await prisma.account.update({
        where: { id: acc.id },
        data: {
          groupId: g.id,
          partyType:
            targetGroupName === "Sundry Debtors"
              ? "DEBTOR"
              : targetGroupName === "Sundry Creditors"
                ? "CREDITOR"
                : null,
        },
      });
    }
  }

  return byName;
}
