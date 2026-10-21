import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import { canonicalExportSchema, type CanonicalExport, type CanonicalTransaction } from "@/lib/export/canonical-schema";
import { getAdapter } from "@/lib/export/registry";
import { resolveConfig, postingDocuments } from "@/lib/export/adapters/shared";
import { XERO_MANUAL_JOURNAL_HEADER } from "@/lib/export/adapters/xero";
import { GENERIC_CSV_JOURNAL_HEADER } from "@/lib/export/adapters/generic-csv";
import { tallyVoucherKind } from "@/lib/export/adapters/tallyprime";
import type { AccountMapping, AdapterInput } from "@/lib/export/types";

// ───────────────────────────── Fixture ─────────────────────────────

const userA = { userId: "USR-002", name: "User A" };
const userB = { userId: "USR-003", name: "User B" };
const admin = { userId: "USR-001", name: "Admin A" };

function txn(p: Partial<CanonicalTransaction> & Pick<CanonicalTransaction, "transactionId" | "type" | "description" | "amount" | "journalLines">): CanonicalTransaction {
  return {
    transactionDate: "2026-10-15",
    currency: "INR",
    category: null,
    paymentMethod: "Bank Transfer",
    status: "posted",
    posted: true,
    exchangeRate: "1",
    baseAmount: p.amount,
    reference: null,
    counterparty: null,
    journalEntryId: `JE-${p.transactionId.slice(4)}`,
    reversal: null,
    exportScope: "full",
    audit: { createdBy: userA, createdAt: "2026-10-15T05:00:00.000Z", source: "voice", postedBy: userA, postedAt: "2026-10-15T05:00:01.000Z" },
    ...p,
  };
}

const line = (accountCode: string, debit: string, credit: string, description: string | null = null) => ({ accountCode, debit, credit, description });

function fixture(): CanonicalExport {
  const transactions: CanonicalTransaction[] = [
    txn({ transactionId: "TXN-0001", type: "expense", description: "Office Electricity", amount: "2500.00", category: "Electricity Expense", journalLines: [line("EXP-ELEC", "2500.00", "0.00"), line("BANK-HDFC", "0.00", "2500.00")] }),
    txn({
      transactionId: "TXN-0002",
      type: "income",
      description: 'Dinner & "drinks" <client>, Mumbai',
      amount: "50000.00",
      audit: { createdBy: userB, createdAt: "2026-10-15T06:30:00.000Z", source: "text", postedBy: userB, postedAt: "2026-10-15T06:30:00.000Z" },
      journalLines: [line("BANK-HDFC", "50000.00", "0.00"), line("INC-SERVICE", "0.00", "50000.00", "Service = fees")],
    }),
    txn({ transactionId: "TXN-0003", type: "transfer", description: "Move to ICICI", amount: "10000.00", journalLines: [line("BANK-ICICI", "10000.00", "0.00"), line("BANK-HDFC", "0.00", "10000.00")] }),
    txn({
      transactionId: "TXN-0004",
      type: "expense",
      description: "Petrol",
      amount: "1500.00",
      status: "reversed",
      journalLines: [line("EXP-FUEL", "1500.00", "0.00"), line("CASH", "0.00", "1500.00")],
      reversal: { journalEntryId: "JE-0009", date: "2026-10-16", reason: "Duplicate entry", reversedBy: admin, reversedAt: "2026-10-16T04:00:00.000Z", journalLines: [line("EXP-FUEL", "0.00", "1500.00"), line("CASH", "1500.00", "0.00")] },
    }),
    txn({ transactionId: "TXN-0005", type: "journal", description: "Accrue audit fee", amount: "8000.00", isAdjustment: true, journalLines: [line("EXP-PROF", "8000.00", "0.00"), line("AP", "0.00", "8000.00")] }),
  ];
  return {
    schemaVersion: "1.0",
    exportType: "accounting_transactions",
    generatedAt: "2026-10-16T10:00:00.000Z",
    generatedBy: admin,
    workspace: { workspaceId: "WS-001", workspaceName: "ABC Technologies", currency: "INR", workspaceCode: "ABC", companyName: "ABC Technologies Pvt Ltd" },
    accounts: [
      { accountCode: "AP", accountName: "Accounts Payable", accountType: "liability", subtype: "PAYABLE" },
      { accountCode: "BANK-HDFC", accountName: "HDFC Bank", accountType: "asset", subtype: "BANK" },
      { accountCode: "BANK-ICICI", accountName: "ICICI Bank", accountType: "asset", subtype: "BANK" },
      { accountCode: "CASH", accountName: "Cash in Hand", accountType: "asset", subtype: "CASH" },
      { accountCode: "EXP-ELEC", accountName: "Office Electricity Expense", accountType: "expense", subtype: null },
      { accountCode: "EXP-FUEL", accountName: "Fuel Expense", accountType: "expense", subtype: null },
      { accountCode: "EXP-PROF", accountName: "Professional Fees", accountType: "expense", subtype: null },
      { accountCode: "INC-SERVICE", accountName: "Service Revenue", accountType: "income", subtype: null },
    ],
    transactions,
  };
}

const ACCOUNT_CODES = ["AP", "BANK-HDFC", "BANK-ICICI", "CASH", "EXP-ELEC", "EXP-FUEL", "EXP-PROF", "INC-SERVICE"];

function mappings(kind: "name" | "numeric" | "xero"): Record<string, AccountMapping> {
  const out: Record<string, AccountMapping> = {};
  ACCOUNT_CODES.forEach((code, i) => {
    out[code] =
      kind === "numeric"
        ? { externalCode: String(460000000000300 + i), externalName: `Ext ${code}` }
        : kind === "xero"
          ? { externalCode: String(400 + i), externalName: null }
          : { externalCode: `${code} Ledger`, externalName: code === "BANK-HDFC" ? "HDFC Bank A/c & Co <Main>" : `${code} Ledger` };
  });
  return out;
}

function input(key: string, over: Partial<AdapterInput> = {}): AdapterInput {
  const adapter = getAdapter(key)!;
  return {
    canonical: fixture(),
    mappings: {},
    config: resolveConfig(adapter, {}),
    fileBaseName: `ABC_${key}_2026-10-01_2026-10-31`,
    ...over,
  };
}

const errors = (issues: { level: string; code: string }[]) => issues.filter((i) => i.level === "error");

/** All element names in an XML document. */
function tagNames(xml: string) {
  return new Set([...xml.matchAll(/<([A-Z][A-Z.]*)[\s>]/g)].map((m) => m[1]));
}

// ───────────────────────────── Tests ─────────────────────────────

describe("posting documents", () => {
  it("emits each posted transaction plus its reversal, all balanced", () => {
    const docs = postingDocuments(fixture());
    expect(docs.map((d) => d.ref)).toEqual(["TXN-0001", "TXN-0002", "TXN-0003", "TXN-0004", "TXN-0004-REV", "TXN-0005"]);
    for (const d of docs) {
      const dr = d.lines.reduce((s, l) => s.plus(l.debit), new Decimal(0));
      const cr = d.lines.reduce((s, l) => s.plus(l.credit), new Decimal(0));
      expect(dr.eq(cr)).toBe(true);
    }
  });

  it("emits only the reversal when the original was exported before", () => {
    const c = fixture();
    c.transactions[3].exportScope = "reversal_only";
    expect(postingDocuments(c).map((d) => d.ref)).toContain("TXN-0004-REV");
    expect(postingDocuments(c).map((d) => d.ref)).not.toContain("TXN-0004");
  });
});

describe("canonical-json adapter", () => {
  it("produces schema-valid JSON that keeps creator information", () => {
    const a = getAdapter("canonical-json")!;
    const i = input("canonical-json");
    expect(errors(a.validate(i))).toEqual([]);
    const out = a.generate(i);
    const parsed = canonicalExportSchema.parse(JSON.parse(out.files[0].content));
    expect(parsed.transactions.every((t) => t.audit.createdBy.userId && t.audit.createdBy.name)).toBe(true);
    expect(out.files[0].fileName).toMatch(/\.json$/);
  });

  it("allows drafts with proposed lines", () => {
    const c = fixture();
    c.transactions[0].status = "draft";
    c.transactions[0].posted = false;
    expect(errors(getAdapter("canonical-json")!.validate(input("canonical-json", { canonical: c })))).toEqual([]);
  });
});

describe("generic-csv adapter", () => {
  it("writes one RFC 4180 row per journal line with creator columns", () => {
    const a = getAdapter("generic-csv")!;
    const out = a.generate(input("generic-csv")).files[0].content;
    const rows = out.split("\r\n");
    expect(rows[0]).toBe(GENERIC_CSV_JOURNAL_HEADER.join(","));
    expect(rows.filter(Boolean)).toHaveLength(1 + 12);
    expect(out).toContain('"Dinner & ""drinks"" <client>, Mumbai"');
    expect(out).toContain("User B,USR-003,2026-10-15T06:30:00.000Z,text");
    expect(out).toContain(",Service = fees,"); // only text that starts with a formula character is neutralised
    expect(out).toMatch(/TXN-0004,JE-0009,reversal/);
    expect(out.endsWith("\r\n")).toBe(true);
  });

  it("rejects drafts and unbalanced entries", () => {
    const a = getAdapter("generic-csv")!;
    const c = fixture();
    c.transactions[0].status = "draft";
    c.transactions[1].journalLines[1].credit = "49999.00";
    const codes = errors(a.validate(input("generic-csv", { canonical: c }))).map((e) => e.code);
    expect(codes).toContain("UNPOSTED_TRANSACTION");
    expect(codes).toContain("UNBALANCED_ENTRY");
    expect(() => a.generate(input("generic-csv", { canonical: c }))).not.toThrow(); // generic CSV generate is only called after validation by the service
  });
});

describe("tallyprime adapter", () => {
  const cfg = () => resolveConfig(getAdapter("tallyprime")!, { companyName: "ABC Technologies Pvt Ltd & Co" });

  it("requires the company name and a ledger mapping for every account", () => {
    const a = getAdapter("tallyprime")!;
    const codes = errors(a.validate(input("tallyprime"))).map((e) => e.code);
    expect(codes).toContain("MISSING_CONFIG");
    expect(codes.filter((c) => c === "MISSING_MAPPING")).toHaveLength(ACCOUNT_CODES.length);
    expect(() => a.generate(input("tallyprime"))).toThrow(/blocked/);
  });

  it("generates the documented voucher envelope with debit = negative/Yes and escaped text", () => {
    const a = getAdapter("tallyprime")!;
    const i = input("tallyprime", { mappings: mappings("name"), config: cfg() });
    expect(errors(a.validate(i))).toEqual([]);
    const xml = a.generate(i).files[0].content;
    expect(xml).toContain("<TALLYREQUEST>Import</TALLYREQUEST>");
    expect(xml).toContain("<ID>Vouchers</ID>");
    expect(xml).toContain("<SVCURRENTCOMPANY>ABC Technologies Pvt Ltd &amp; Co</SVCURRENTCOMPANY>");
    expect(xml).toContain("<LEDGERNAME>HDFC Bank A/c &amp; Co &lt;Main&gt;</LEDGERNAME>");
    expect(xml).toContain("Dinner &amp; &quot;drinks&quot; &lt;client&gt;, Mumbai");
    expect(xml).toContain("Created by User A (USR-002) - 2026-10-15 05:00 UTC - via voice");
    expect(xml).toContain("<DATE>20261015</DATE>");
    // Only documented tags — no invented properties.
    const allowed = new Set(["ENVELOPE", "HEADER", "VERSION", "TALLYREQUEST", "TYPE", "ID", "BODY", "DESC", "STATICVARIABLES", "SVCURRENTCOMPANY", "DATA", "TALLYMESSAGE", "VOUCHER", "DATE", "VOUCHERTYPENAME", "VOUCHERNUMBER", "NARRATION", "ALLLEDGERENTRIES.LIST", "LEDGERNAME", "ISDEEMEDPOSITIVE", "AMOUNT"]);
    for (const t of tagNames(xml)) expect(allowed.has(t)).toBe(true);
    // Every voucher nets to zero and the sign follows ISDEEMEDPOSITIVE.
    for (const v of xml.split("<VOUCHER ").slice(1)) {
      const entries = [...v.matchAll(/<ISDEEMEDPOSITIVE>(Yes|No)<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>(-?[\d.]+)<\/AMOUNT>/g)];
      expect(entries.length).toBeGreaterThanOrEqual(2);
      let sum = new Decimal(0);
      for (const [, deemed, amt] of entries) {
        expect(deemed === "Yes").toBe(amt.startsWith("-"));
        sum = sum.plus(amt);
      }
      expect(sum.isZero()).toBe(true);
    }
  });

  it("chooses Payment / Receipt / Contra / Journal from where money moves", () => {
    const c = fixture();
    const subtypes = new Map(c.accounts!.map((a) => [a.accountCode, a.subtype ?? null]));
    const kinds = postingDocuments(c).map((d) => `${d.ref}:${tallyVoucherKind(d, subtypes)}`);
    expect(kinds).toEqual(["TXN-0001:payment", "TXN-0002:receipt", "TXN-0003:contra", "TXN-0004:payment", "TXN-0004-REV:receipt", "TXN-0005:journal"]);
    const xml = getAdapter("tallyprime")!.generate(input("tallyprime", { mappings: mappings("name"), config: cfg() })).files[0].content;
    expect(xml).toContain('<VOUCHER VCHTYPE="Contra" ACTION="Create">');
    expect(xml).toContain("<VOUCHERNUMBER>TXN-0004-REV</VOUCHERNUMBER>");
  });

  it("omits voucher numbers when Tally numbering is selected", () => {
    const a = getAdapter("tallyprime")!;
    const xml = a.generate(input("tallyprime", { mappings: mappings("name"), config: resolveConfig(a, { companyName: "ABC", voucherNumbering: "tally" }) })).files[0].content;
    expect(xml).not.toContain("<VOUCHERNUMBER>");
  });
});

describe("zoho-books adapter", () => {
  it("emits documented journal request bodies with mapped account ids", () => {
    const a = getAdapter("zoho-books")!;
    const i = input("zoho-books", { mappings: mappings("numeric") });
    expect(errors(a.validate(i))).toEqual([]);
    const payloads = JSON.parse(a.generate(i).files[0].content) as Record<string, unknown>[];
    expect(payloads).toHaveLength(6);
    const allowedTop = new Set(["journal_date", "reference_number", "notes", "journal_type", "status", "line_items", "custom_fields"]);
    for (const p of payloads) {
      for (const k of Object.keys(p)) expect(allowedTop.has(k)).toBe(true);
      expect(p.status).toBe("draft");
      expect(String(p.notes)).toMatch(/Created by (User A \(USR-002\)|User B \(USR-003\))/);
      const items = p.line_items as Record<string, unknown>[];
      let dr = new Decimal(0);
      let cr = new Decimal(0);
      for (const li of items) {
        expect(Object.keys(li).sort()).toEqual(["account_id", "amount", "debit_or_credit", "description"]);
        expect(String(li.account_id)).toMatch(/^\d+$/);
        if (li.debit_or_credit === "debit") dr = dr.plus(li.amount as number);
        else cr = cr.plus(li.amount as number);
      }
      expect(dr.eq(cr)).toBe(true);
    }
    expect(payloads[0].journal_date).toBe("2026-10-15");
    expect(payloads[0].reference_number).toBe("TXN-0001");
  });

  it("adds the creator custom field only when configured and rejects non-numeric ids", () => {
    const a = getAdapter("zoho-books")!;
    const withCf = a.generate(input("zoho-books", { mappings: mappings("numeric"), config: resolveConfig(a, { createdByCustomFieldId: "460000000098001" }) }));
    expect(JSON.parse(withCf.files[0].content)[0].custom_fields).toEqual([{ customfield_id: "460000000098001", value: "User A (USR-002)" }]);
    const bad = { ...mappings("numeric"), "EXP-ELEC": { externalCode: "Electricity" } };
    expect(errors(a.validate(input("zoho-books", { mappings: bad }))).map((e) => e.code)).toContain("INVALID_MAPPING");
  });
});

describe("quickbooks-online adapter", () => {
  it("emits JournalEntry objects with balanced Debit/Credit lines and PrivateNote provenance", () => {
    const a = getAdapter("quickbooks-online")!;
    const m = mappings("numeric");
    for (const k of Object.keys(m)) m[k] = { externalCode: String(30 + ACCOUNT_CODES.indexOf(k)), externalName: `QB ${k}` };
    const i = input("quickbooks-online", { mappings: m });
    const issues = a.validate(i);
    expect(errors(issues)).toEqual([]);
    expect(issues.some((x) => x.code === "ENTITY_REQUIRED" && x.accountCode === "AP")).toBe(true);
    const entries = JSON.parse(a.generate(i).files[0].content) as Record<string, unknown>[];
    for (const e of entries) {
      for (const k of Object.keys(e)) expect(["DocNumber", "TxnDate", "PrivateNote", "Adjustment", "Line"]).toContain(k);
      expect(String(e.DocNumber).length).toBeLessThanOrEqual(21);
      expect(String(e.PrivateNote)).toContain("Created by");
      let dr = new Decimal(0);
      let cr = new Decimal(0);
      for (const l of e.Line as Record<string, any>[]) {
        expect(Object.keys(l).sort()).toEqual(["Amount", "Description", "DetailType", "JournalEntryLineDetail"]);
        expect(l.DetailType).toBe("JournalEntryLineDetail");
        expect(Object.keys(l.JournalEntryLineDetail).sort()).toEqual(["AccountRef", "PostingType"]);
        if (l.JournalEntryLineDetail.PostingType === "Debit") dr = dr.plus(l.Amount);
        else cr = cr.plus(l.Amount);
      }
      expect(dr.eq(cr)).toBe(true);
    }
    expect(entries.find((e) => e.DocNumber === "TXN-0005")!.Adjustment).toBe(true);
  });
});

describe("xero adapter", () => {
  it("writes the manual journal template with signed amounts and narration provenance", () => {
    const a = getAdapter("xero")!;
    const i = input("xero", { mappings: mappings("xero") });
    const issues = a.validate(i);
    expect(errors(issues)).toEqual([]);
    expect(issues.filter((x) => x.code === "XERO_RESTRICTED_ACCOUNT").map((x) => x.accountCode).sort()).toEqual(["AP", "BANK-HDFC", "BANK-ICICI", "CASH"]);
    const csv = a.generate(i).files[0].content;
    const rows = csv.trimEnd().split("\r\n");
    expect(rows[0]).toBe(XERO_MANUAL_JOURNAL_HEADER.join(","));
    expect(rows).toHaveLength(13);
    expect(rows[1]).toMatch(/^"?Office Electricity \| Created by User A \(USR-002\)/);
    expect(rows[1]).toContain(",15/10/2026,");
    expect(rows[1]).toContain(",Tax Exempt,2500.00,,,,");
    expect(rows[2]).toContain(",Tax Exempt,-2500.00,,,,");
    // Each journal (same narration) nets to zero.
    const sums = new Map<string, Decimal>();
    for (const r of rows.slice(1)) {
      const ref = /VLedger (TXN-\d+ \/ JE-\d+)/.exec(r)![1];
      const amount = r.split(",").at(-5)!;
      sums.set(ref, (sums.get(ref) ?? new Decimal(0)).plus(amount));
    }
    expect(sums.size).toBe(6);
    for (const v of sums.values()) expect(v.isZero()).toBe(true);
  });

  it("uses the configured tax rate and US dates, and validates account codes", () => {
    const a = getAdapter("xero")!;
    const csv = a.generate(input("xero", { mappings: mappings("xero"), config: resolveConfig(a, { taxRate: "No GST", dateFormat: "MM/DD/YYYY" }) })).files[0].content;
    expect(csv).toContain(",10/15/2026,");
    expect(csv).toContain(",No GST,");
    const bad = { ...mappings("xero"), CASH: { externalCode: "TOO-LONG-CODE-123" } };
    expect(errors(a.validate(input("xero", { mappings: bad }))).map((e) => e.code)).toContain("INVALID_MAPPING");
  });
});

describe("custom adapter", () => {
  it("is not configured until columns are defined", () => {
    const a = getAdapter("custom")!;
    expect(errors(a.validate(input("custom"))).map((e) => e.code)).toContain("MISSING_CONFIG");
  });

  it("writes only the configured whitelisted columns", () => {
    const a = getAdapter("custom")!;
    const config = resolveConfig(a, {
      columns: [
        { field: "date", header: "Posting Date" },
        { field: "documentRef", header: "Ref" },
        { field: "accountCode", header: "GL" },
        { field: "signedAmount", header: "Amount" },
        { field: "createdByName", header: "Entered By" },
      ],
      delimiter: "semicolon",
      dateFormat: "DD/MM/YYYY",
    });
    const i = input("custom", { config });
    expect(errors(a.validate(i))).toEqual([]);
    const rows = a.generate(i).files[0].content.trimEnd().split("\r\n");
    expect(rows[0]).toBe("Posting Date;Ref;GL;Amount;Entered By");
    expect(rows[1]).toBe("15/10/2026;TXN-0001;EXP-ELEC;2500.00;User A");
    expect(rows[2]).toBe("15/10/2026;TXN-0001;BANK-HDFC;-2500.00;User A");
    const bad = resolveConfig(a, { columns: [{ field: "passwordHash", header: "x" }] });
    expect(errors(a.validate(input("custom", { config: bad }))).map((e) => e.code)).toContain("INVALID_CONFIG");
  });
});

describe("planned adapters", () => {
  it.each(["busy", "sap", "dynamics-365"])("%s reports Not Implemented and never generates", (key) => {
    const a = getAdapter(key)!;
    expect(a.implemented).toBe(false);
    expect(a.validate(input(key))[0].code).toBe("NOT_IMPLEMENTED");
    expect(() => a.generate(input(key))).toThrow(/not implemented/);
  });
});
