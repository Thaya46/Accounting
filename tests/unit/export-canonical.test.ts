import { describe, expect, it } from "vitest";
import { canonicalExportSchema, formatZodIssues } from "@/lib/export/canonical-schema";
import { transactionsChecksum } from "@/lib/export/checksum";
import { buildAuditMetadata, auditFileName } from "@/lib/export/audit-file";
import { computeAdapterStatus } from "@/lib/export/status";
import { exportRequestSchema, resolvePeriod } from "@/lib/export/filters";
import { getAdapter, listAdapters, adapterSpec } from "@/lib/export/registry";
import { ADAPTER_CATALOG } from "@/lib/export/adapter-keys";
import { missingConfig, resolveConfig } from "@/lib/export/adapters/shared";
import { csvField, toCsv, xmlEscape, csvSafeText } from "@/lib/export/formats";

/** The example from REQUIREMENTS.md §8, verbatim. */
const REQUIREMENT_EXAMPLE = `{
  "schemaVersion": "1.0",
  "exportType": "accounting_transactions",
  "workspace": {
    "workspaceId": "WS-001",
    "workspaceName": "ABC Technologies",
    "currency": "INR"
  },
  "transactions": [
    {
      "transactionId": "TXN-0001",
      "transactionDate": "2026-10-15",
      "type": "expense",
      "description": "Office Electricity",
      "amount": "2500.00",
      "currency": "INR",
      "category": "Electricity Expense",
      "paymentMethod": "Bank Transfer",
      "journalLines": [
        {
          "accountCode": "EXP-ELEC",
          "debit": "2500.00",
          "credit": "0.00"
        },
        {
          "accountCode": "BANK-HDFC",
          "debit": "0.00",
          "credit": "2500.00"
        }
      ],
      "audit": {
        "createdBy": {
          "userId": "USR-001",
          "name": "User A"
        },
        "createdAt": "2026-10-15T05:00:00Z",
        "source": "voice"
      }
    }
  ]
}`;

describe("canonical schema 1.0", () => {
  it("accepts the requirement example verbatim", () => {
    const parsed = canonicalExportSchema.safeParse(JSON.parse(REQUIREMENT_EXAMPLE));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.transactions[0].audit.createdBy).toEqual({ userId: "USR-001", name: "User A" });
      expect(parsed.data.transactions[0].journalLines).toHaveLength(2);
    }
  });

  it("requires creator information on every transaction", () => {
    const doc = JSON.parse(REQUIREMENT_EXAMPLE);
    delete doc.transactions[0].audit.createdBy;
    const parsed = canonicalExportSchema.safeParse(doc);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issues = formatZodIssues(parsed.error);
      expect(issues[0].path).toBe("transactions[0].audit.createdBy");
    }
  });

  it("rejects malformed amounts, dates, types and versions with readable paths", () => {
    const doc = JSON.parse(REQUIREMENT_EXAMPLE);
    doc.schemaVersion = "2.0";
    doc.transactions[0].amount = "2,500.00";
    doc.transactions[0].transactionDate = "2026-02-30";
    doc.transactions[0].type = "Expense";
    doc.transactions[0].journalLines[0].debit = 2500;
    const parsed = canonicalExportSchema.safeParse(doc);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const paths = formatZodIssues(parsed.error).map((i) => i.path);
      expect(paths).toEqual(
        expect.arrayContaining(["schemaVersion", "transactions[0].amount", "transactions[0].transactionDate", "transactions[0].type", "transactions[0].journalLines[0].debit"]),
      );
    }
  });

  it("rejects a non-object root and a missing workspace", () => {
    expect(canonicalExportSchema.safeParse([]).success).toBe(false);
    const doc = JSON.parse(REQUIREMENT_EXAMPLE);
    delete doc.workspace;
    const parsed = canonicalExportSchema.safeParse(doc);
    expect(parsed.success).toBe(false);
  });

  it("checksums the transactions array deterministically", () => {
    const doc = canonicalExportSchema.parse(JSON.parse(REQUIREMENT_EXAMPLE));
    const a = transactionsChecksum(doc.transactions);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(transactionsChecksum(JSON.parse(JSON.stringify(doc.transactions)))).toBe(a);
    doc.transactions[0].amount = "2500.01";
    expect(transactionsChecksum(doc.transactions)).not.toBe(a);
  });
});

describe("audit metadata file", () => {
  it("carries full attribution for every transaction and names the data file", () => {
    const doc = canonicalExportSchema.parse(JSON.parse(REQUIREMENT_EXAMPLE));
    const tally = getAdapter("tallyprime")!;
    const meta = buildAuditMetadata(doc, { exportJobId: "job-1", adapter: tally, dataFileName: "ABC.xml", dataFileSha256: "a".repeat(64) });
    expect(meta.kind).toBe("vledger_audit_metadata");
    expect(meta.export.dataFileName).toBe("ABC.xml");
    expect(meta.provenanceTransfer.fullAuditTransfer).toBe(false);
    expect(meta.description).toMatch(/cannot store all/);
    expect(meta.transactions).toHaveLength(1);
    expect(meta.transactions[0].audit.createdBy.name).toBe("User A");
    expect(auditFileName("ABC_tallyprime.xml")).toBe("ABC_tallyprime.audit.json");
  });
});

describe("adapter status", () => {
  const base = { platformEnabled: true, implemented: true, missingConfig: [], unmappedAccounts: [], validationErrors: 0 };
  it("applies the documented precedence", () => {
    expect(computeAdapterStatus({ ...base, platformEnabled: false, implemented: false }).label).toBe("Disabled by Super Admin");
    expect(computeAdapterStatus({ ...base, implemented: false }).label).toBe("Not Implemented");
    expect(computeAdapterStatus({ ...base, missingConfig: ["Company name"], validationErrors: 3 }).label).toBe("Configuration Required");
    expect(computeAdapterStatus({ ...base, unmappedAccounts: ["EXP-ELEC"] }).reasons[0]).toContain("EXP-ELEC");
    expect(computeAdapterStatus({ ...base, invalidConfig: ["bad id"] }).status).toBe("configuration_required");
    expect(computeAdapterStatus({ ...base, validationErrors: 2 }).label).toBe("Validation Failed");
    expect(computeAdapterStatus(base).label).toBe("Available");
  });
});

describe("registry and configuration", () => {
  it("implements every catalog key with honest metadata", () => {
    expect(listAdapters().map((a) => a.key)).toEqual(ADAPTER_CATALOG.map((a) => a.key));
    for (const a of listAdapters()) {
      const spec = adapterSpec(a);
      expect(spec.specReferences.length).toBeGreaterThan(0);
      for (const r of spec.specReferences) expect(r.url).toMatch(/^https:\/\//);
      const text = JSON.stringify(spec).toLowerCase();
      expect(text).not.toContain("import-ready");
      expect(text).not.toMatch(/\bverified\b/);
    }
    for (const key of ["busy", "sap", "dynamics-365"]) expect(getAdapter(key)!.implemented).toBe(false);
  });

  it("applies defaults and reports missing required settings", () => {
    const tally = getAdapter("tallyprime")!;
    const cfg = resolveConfig(tally, { voucherNumbering: "bogus", extra: "x" });
    expect(cfg.voucherNumbering).toBe("reference");
    expect(cfg.paymentVoucherType).toBe("Payment");
    expect("extra" in cfg).toBe(false);
    expect(missingConfig(tally, cfg)).toEqual(["TallyPrime company name"]);
    expect(missingConfig(tally, resolveConfig(tally, { companyName: "ABC Pvt Ltd" }))).toEqual([]);
    const xero = getAdapter("xero")!;
    expect(resolveConfig(xero, {}).taxRate).toBe("Tax Exempt");
    expect(missingConfig(getAdapter("custom")!, resolveConfig(getAdapter("custom")!, {}))).toEqual(["Columns"]);
  });
});

describe("export request and periods", () => {
  it("resolves financial years and validates custom ranges", () => {
    expect(resolvePeriod({ kind: "fy", startYear: 2026 }, 4)).toEqual({ from: "2026-04-01", to: "2027-03-31", label: "FY 2026-27" });
    expect(resolvePeriod({ kind: "custom", from: "2026-10-01", to: "2026-10-31" }, 4).label).toBeNull();
    expect(() => resolvePeriod({ kind: "custom", from: "2026-10-31", to: "2026-10-01" }, 4)).toThrow();
  });
  it("defaults to posted and reversed statuses and rejects unknown adapters", () => {
    const r = exportRequestSchema.parse({ adapterKey: "canonical-json", period: { kind: "fy", startYear: 2026 } });
    expect(r.statuses).toEqual(["POSTED", "REVERSED"]);
    expect(r.exportType).toBe("accounting_transactions");
    expect(exportRequestSchema.safeParse({ adapterKey: "excel", period: { kind: "fy", startYear: 2026 } }).success).toBe(false);
  });
});

describe("serializers", () => {
  it("quotes CSV per RFC 4180 and neutralises formulas", () => {
    expect(csvField('Dinner, "VIP"')).toBe('"Dinner, ""VIP"""');
    expect(csvField("line\nbreak")).toBe('"line\nbreak"');
    expect(csvField("plain")).toBe("plain");
    expect(toCsv(["a", "b"], [["1", "2"]])).toBe("a,b\r\n1,2\r\n");
    expect(csvSafeText("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvSafeText("-50 discount")).toBe("-50 discount");
  });
  it("escapes XML special characters and strips invalid control characters", () => {
    expect(xmlEscape(`A & B <"x"> 'y'\u0001`)).toBe("A &amp; B &lt;&quot;x&quot;&gt; &apos;y&apos;");
  });
});
