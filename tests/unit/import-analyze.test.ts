import { describe, expect, it } from "vitest";
import { accountCodesOf, categoriesOf, confirmImportSchema, fileIssues, parseImportFile, planRecords, workspaceMatches, type HashFn } from "@/lib/import/analyze";
import type { CanonicalExport } from "@/lib/export/canonical-schema";

const hash: HashFn = (i) => `${i.type}|${i.amount}|${i.date}|${i.description.toLowerCase()}`;
const ws = { ref: "WS-001", code: "ABC", currency: "INR" };

function file(over: Partial<CanonicalExport> = {}): CanonicalExport {
  return {
    schemaVersion: "1.0",
    exportType: "accounting_transactions",
    workspace: { workspaceId: "WS-001", workspaceName: "ABC Technologies", currency: "INR", workspaceCode: "ABC" },
    transactions: [
      {
        transactionId: "TXN-0001",
        transactionDate: "2026-10-15",
        type: "expense",
        description: "Office Electricity",
        amount: "2500.00",
        currency: "INR",
        category: "Electricity Expense",
        paymentMethod: "Bank Transfer",
        journalLines: [
          { accountCode: "EXP-ELEC", accountName: "Office Electricity Expense", debit: "2500.00", credit: "0.00" },
          { accountCode: "BANK-HDFC", accountName: "HDFC Bank", debit: "0.00", credit: "2500.00" },
        ],
        audit: { createdBy: { userId: "USR-001", name: "User A" }, createdAt: "2026-10-15T05:00:00Z", source: "voice" },
      },
    ],
    ...over,
  };
}

function txn(over: Partial<CanonicalExport["transactions"][number]>): CanonicalExport["transactions"][number] {
  return { ...file().transactions[0], ...over };
}

describe("import file parsing", () => {
  it("accepts the canonical example", () => {
    const r = parseImportFile(JSON.stringify(file()));
    expect(r.ok).toBe(true);
  });

  it("rejects empty, non-JSON and oversized files with readable messages", () => {
    expect(parseImportFile("  ")).toEqual({ ok: false, errors: [{ path: "(file)", message: "The file is empty." }] });
    const bad = parseImportFile("{ not json");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors[0].message).toMatch(/^Not valid JSON/);
    const big = parseImportFile(" ".repeat(5 * 1024 * 1024 + 1) + "{}");
    expect(big.ok).toBe(false);
  });

  it("reports schema violations with JSON paths", () => {
    const doc = JSON.parse(JSON.stringify(file())) as Record<string, any>;
    doc.transactions[0].journalLines[1].credit = "two thousand";
    delete doc.transactions[0].audit.createdBy.name;
    doc.workspace.currency = "rupees";
    const r = parseImportFile(JSON.stringify(doc));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const paths = r.errors.map((e) => e.path);
      expect(paths).toContain("transactions[0].journalLines[1].credit");
      expect(paths).toContain("transactions[0].audit.createdBy.name");
      expect(paths).toContain("workspace.currency");
    }
  });

  it("strips a UTF-8 BOM", () => {
    expect(parseImportFile("﻿" + JSON.stringify(file())).ok).toBe(true);
  });
});

describe("workspace validation", () => {
  it("matches by WS reference and code", () => {
    expect(workspaceMatches(file().workspace, ws)).toBe(true);
    expect(workspaceMatches({ ...file().workspace, workspaceCode: "GLX" }, ws)).toBe(false);
    expect(workspaceMatches({ ...file().workspace, workspaceId: "WS-002", workspaceCode: null }, ws)).toBe(false);
  });

  it("warns on another workspace and blocks currency mismatches and ledger files", () => {
    expect(fileIssues(file(), ws)).toEqual([]);
    const other = fileIssues(file({ workspace: { workspaceId: "WS-002", workspaceName: "Globex Retail", currency: "INR", workspaceCode: "GLX" } }), ws);
    expect(other).toHaveLength(1);
    expect(other[0].level).toBe("warning");
    expect(other[0].message).toContain("Globex Retail");
    expect(fileIssues(file({ workspace: { ...file().workspace, currency: "USD" } }), ws).some((i) => i.level === "error" && /currency/.test(i.message))).toBe(true);
    expect(fileIssues(file({ exportType: "account_ledger" }), ws).some((i) => i.level === "error")).toBe(true);
    expect(fileIssues(file({ transactions: [] }), ws).some((i) => /no transactions/.test(i.message))).toBe(true);
  });
});

describe("record planning", () => {
  it("plans a balanced two-line expense as an EXPENSE and keeps the file creator as external provenance", () => {
    const [r] = planRecords(file(), ws, hash);
    expect(r.importType).toBe("EXPENSE");
    expect(r.issues).toEqual([]);
    expect(r.balanced).toBe(true);
    expect(r.externalCreator).toEqual({ userId: "USR-001", name: "User A" });
    expect(r).not.toHaveProperty("createdBy");
    expect(r.hash).toBe("EXPENSE|2500.00|2026-10-15|office electricity");
  });

  it("rejects unbalanced lines, lines with both sides and amount mismatches", () => {
    const records = planRecords(
      file({
        transactions: [
          txn({ transactionId: "T1", journalLines: [{ accountCode: "A", debit: "100.00", credit: "0.00" }, { accountCode: "B", debit: "0.00", credit: "90.00" }] }),
          txn({ transactionId: "T2", journalLines: [{ accountCode: "A", debit: "100.00", credit: "100.00" }, { accountCode: "B", debit: "0.00", credit: "0.00" }] }),
          txn({ transactionId: "T3", amount: "2400.00" }),
          txn({ transactionId: "T4", journalLines: [{ accountCode: "A", debit: "100.00", credit: "0.00" }] }),
        ],
      }),
      ws,
      hash,
    );
    expect(records[0].issues.join(" ")).toMatch(/do not balance/);
    expect(records[1].issues.join(" ")).toMatch(/both a debit and a credit/);
    expect(records[2].issues.join(" ")).toMatch(/does not match the journal lines/);
    expect(records[3].issues.join(" ")).toMatch(/at least two journal lines/);
  });

  it("converts multi-line income to a journal and imports unposted records as drafts", () => {
    const [multi, draft] = planRecords(
      file({
        transactions: [
          txn({
            transactionId: "T1",
            type: "income",
            amount: "1180.00",
            journalLines: [
              { accountCode: "BANK", debit: "1180.00", credit: "0.00" },
              { accountCode: "INC", debit: "0.00", credit: "1000.00" },
              { accountCode: "GST", debit: "0.00", credit: "180.00" },
            ],
          }),
          txn({ transactionId: "T2", status: "draft", posted: false }),
        ],
      }),
      ws,
      hash,
    );
    expect(multi.importType).toBe("JOURNAL");
    expect(multi.amount).toBe("1180.00");
    expect(multi.warnings.join(" ")).toMatch(/3 lines/);
    expect(draft.warnings.join(" ")).toMatch(/imported as a draft/);
    expect(draft.issues).toEqual([]);
  });

  it("skips reversed, rejected and reversal-only records", () => {
    const records = planRecords(
      file({ transactions: [txn({ transactionId: "T1", status: "reversed" }), txn({ transactionId: "T2", status: "rejected" }), txn({ transactionId: "T3", exportScope: "reversal_only" })] }),
      ws,
      hash,
    );
    expect(records.every((r) => r.issues.length === 1)).toBe(true);
  });

  it("checks foreign-currency amounts against the exchange rate", () => {
    const usdLines = [
      { accountCode: "EXP", debit: "8325.00", credit: "0.00" },
      { accountCode: "BANK", debit: "0.00", credit: "8325.00" },
    ];
    const [ok, missing, wrong] = planRecords(
      file({
        transactions: [
          txn({ transactionId: "T1", amount: "100.00", currency: "USD", exchangeRate: "83.25", journalLines: usdLines }),
          txn({ transactionId: "T2", amount: "100.00", currency: "USD", journalLines: usdLines }),
          txn({ transactionId: "T3", amount: "100.00", currency: "USD", exchangeRate: "80", journalLines: usdLines }),
        ],
      }),
      ws,
      hash,
    );
    expect(ok.issues).toEqual([]);
    expect(ok.exchangeRate).toBe("83.25");
    expect(missing.issues.join(" ")).toMatch(/without an exchange rate/);
    expect(wrong.issues.join(" ")).toMatch(/does not equal/);
  });

  it("flags duplicates within the file by id and by content", () => {
    const records = planRecords(file({ transactions: [txn({}), txn({}), txn({ transactionId: "TXN-0099" })] }), ws, hash);
    expect(records[0].duplicate).toBeNull();
    expect(records[1].duplicate?.reason).toMatch(/Repeats TXN-0001/);
    expect(records[2].duplicate?.reason).toMatch(/Same type, amount, date and description/);
  });
});

describe("mapping lists and confirmation input", () => {
  it("lists account codes and kind-aware categories", () => {
    const records = planRecords(
      file({ transactions: [txn({}), txn({ transactionId: "T2", type: "income", category: "Service Revenue", journalLines: [{ accountCode: "BANK-HDFC", debit: "2500.00", credit: "0.00" }, { accountCode: "INC-SERVICE", debit: "0.00", credit: "2500.00" }] })] }),
      ws,
      hash,
    );
    expect(accountCodesOf(records).map((a) => `${a.code}:${a.lines}`)).toEqual(["BANK-HDFC:2", "EXP-ELEC:1", "INC-SERVICE:1"]);
    expect(categoriesOf(records).map((c) => c.key)).toEqual(["EXPENSE:Electricity Expense", "INCOME:Service Revenue"]);
  });

  it("defaults to drafts, skipping duplicates, without acknowledging a mismatch", () => {
    expect(confirmImportSchema.parse({})).toEqual({ accountMap: {}, categoryMap: {}, skipDuplicates: true, postBalanced: false, acknowledgeWorkspaceMismatch: false });
    expect(confirmImportSchema.safeParse({ accountMap: { A: 5 } }).success).toBe(false);
  });
});
