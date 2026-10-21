import { Decimal, money2 } from "@/lib/money";
import type { CanonicalExport, CanonicalTransaction, CanonicalJournalLine } from "@/lib/export/canonical-schema";

function extractTag(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(xml);
  return match ? match[1].trim() : null;
}

function extractAllTags(xml: string, tag: string): string[] {
  const results: string[] = [];
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  let match;
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[1]);
  }
  return results;
}

function parseTallyDate(raw: string): string {
  const cleaned = raw.replace(/\D/g, "");
  if (cleaned.length === 8) {
    const y = cleaned.slice(0, 4);
    const m = cleaned.slice(4, 6);
    const d = cleaned.slice(6, 8);
    return `${y}-${m}-${d}`;
  }
  return new Date().toISOString().slice(0, 10);
}

export function isTallyXml(text: string): boolean {
  const t = text.trim();
  return (t.startsWith("<?xml") || t.startsWith("<ENVELOPE")) && t.includes("<TALLYMESSAGE");
}

export function parseTallyXml(xml: string): CanonicalExport {
  const companyName = extractTag(xml, "SVCURRENTCOMPANY") || "Tally Import";
  const voucherXmls = extractAllTags(xml, "VOUCHER");

  const transactions: CanonicalTransaction[] = [];

  for (let i = 0; i < voucherXmls.length; i++) {
    const vXml = voucherXmls[i];
    const rawDate = extractTag(vXml, "DATE") || "";
    const date = parseTallyDate(rawDate);
    const vchType = (extractTag(vXml, "VOUCHERTYPENAME") || extractTag(vXml, "VCHTYPE") || "Journal").trim();
    const vchNo = extractTag(vXml, "VOUCHERNUMBER") || `TALLY-${i + 1}`;
    const narration = extractTag(vXml, "NARRATION") || `${vchType} Voucher #${vchNo}`;

    // Extract ledger entries
    const rawEntries = [
      ...extractAllTags(vXml, "ALLLEDGERENTRIES.LIST"),
      ...extractAllTags(vXml, "LEDGERENTRIES.LIST"),
    ];

    const lines: CanonicalJournalLine[] = [];
    let totalDebit = new Decimal(0);
    let totalCredit = new Decimal(0);

    for (const entryXml of rawEntries) {
      const ledgerName = extractTag(entryXml, "LEDGERNAME") || "Suspense A/c";
      const isDeemedPositive = (extractTag(entryXml, "ISDEEMEDPOSITIVE") || "").toLowerCase() === "yes";
      const rawAmt = extractTag(entryXml, "AMOUNT") || "0";
      const numAmt = new Decimal(rawAmt).abs();

      // In Tally XML:
      // Negative amount or ISDEEMEDPOSITIVE=Yes represents Debit
      // Positive amount or ISDEEMEDPOSITIVE=No represents Credit
      const isDebit = rawAmt.startsWith("-") || isDeemedPositive;

      const debit = isDebit ? numAmt : new Decimal(0);
      const credit = !isDebit ? numAmt : new Decimal(0);

      totalDebit = totalDebit.plus(debit);
      totalCredit = totalCredit.plus(credit);

      lines.push({
        accountCode: ledgerName,
        accountName: ledgerName,
        debit: money2(debit),
        credit: money2(credit),
        description: null,
      });
    }

    // Determine Canonical Type
    let canonicalType: "expense" | "income" | "transfer" | "journal" = "journal";
    const lowerType = vchType.toLowerCase();
    if (lowerType.includes("payment")) canonicalType = "expense";
    else if (lowerType.includes("receipt")) canonicalType = "income";
    else if (lowerType.includes("contra")) canonicalType = "transfer";
    else if (lowerType.includes("sales")) canonicalType = "income";
    else if (lowerType.includes("purchase")) canonicalType = "expense";

    const txnAmount = totalDebit.gt(0) ? totalDebit : totalCredit;

    transactions.push({
      transactionId: vchNo,
      transactionDate: date,
      type: canonicalType,
      amount: money2(txnAmount),
      currency: "INR",
      exchangeRate: "1",
      description: narration,
      category: null,
      paymentMethod: vchType,
      reference: vchNo,
      notes: `Imported from Tally (${vchType})`,
      counterparty: null,
      isAdjustment: false,
      status: "posted",
      journalLines: lines,
      audit: {
        createdBy: { userId: "tally-import", name: "Tally XML" },
        createdAt: new Date().toISOString(),
        source: "import",
      },
    });
  }

  return {
    schemaVersion: "1.0",
    exportType: "accounting_transactions",
    workspace: {
      workspaceId: "tally-imported",
      workspaceName: companyName,
      currency: "INR",
    },
    transactions,
  };
}
