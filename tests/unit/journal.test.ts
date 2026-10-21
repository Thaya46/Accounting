import { describe, expect, it } from "vitest";
import { isDebitNormal, naturalBalance, reverseLines, simpleLines, toBaseAmount, validateJournalLines } from "@/lib/accounting/journal";

describe("validateJournalLines", () => {
  it("accepts a balanced two-line entry (Dr Electricity / Cr HDFC Bank ₹2,500)", () => {
    const r = validateJournalLines(simpleLines("exp-elec", "bank-hdfc", "2500"));
    expect(r.ok).toBe(true);
    expect(r.totalDebit).toBe("2500.00");
    expect(r.totalCredit).toBe("2500.00");
  });

  it("rejects unbalanced entries", () => {
    const r = validateJournalLines([
      { accountId: "a", debit: "100.00", credit: "0" },
      { accountId: "b", debit: "0", credit: "99.99" },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/must equal credits/);
  });

  it("rejects a line with both debit and credit, zero lines and negative amounts", () => {
    expect(validateJournalLines([{ accountId: "a", debit: "10", credit: "10" }, { accountId: "b", debit: "0", credit: "0" }]).ok).toBe(false);
    expect(validateJournalLines([{ accountId: "a", debit: "-10", credit: "0" }, { accountId: "b", debit: "0", credit: "-10" }]).ok).toBe(false);
  });

  it("requires at least two lines and a positive total", () => {
    expect(validateJournalLines([{ accountId: "a", debit: "10", credit: "0" }]).ok).toBe(false);
    expect(validateJournalLines([]).ok).toBe(false);
  });

  it("rejects more than two decimal places (fixed precision)", () => {
    expect(validateJournalLines([{ accountId: "a", debit: "10.001", credit: "0" }, { accountId: "b", debit: "0", credit: "10.001" }]).ok).toBe(false);
  });

  it("uses exact decimal arithmetic for multi-line entries", () => {
    const r = validateJournalLines([
      { accountId: "a", debit: "0.10", credit: "0" },
      { accountId: "b", debit: "0.20", credit: "0" },
      { accountId: "c", debit: "0", credit: "0.30" },
    ]);
    expect(r.ok).toBe(true);
  });
});

describe("reversals and balances", () => {
  it("reverseLines swaps debits and credits and stays balanced", () => {
    const original = simpleLines("exp", "bank", "1500.00", "Petrol");
    const reversed = reverseLines(original);
    expect(reversed[0]).toMatchObject({ accountId: "exp", debit: "0.00", credit: "1500.00" });
    expect(reversed[1]).toMatchObject({ accountId: "bank", debit: "1500.00", credit: "0.00" });
    expect(validateJournalLines(reversed).ok).toBe(true);
  });

  it("computes natural balances by account type", () => {
    expect(isDebitNormal("ASSET")).toBe(true);
    expect(isDebitNormal("EXPENSE")).toBe(true);
    expect(isDebitNormal("INCOME")).toBe(false);
    expect(naturalBalance("ASSET", "1000", "250").toFixed(2)).toBe("750.00");
    expect(naturalBalance("INCOME", "0", "75000").toFixed(2)).toBe("75000.00");
    expect(naturalBalance("LIABILITY", "100", "40").toFixed(2)).toBe("-60.00");
  });

  it("converts foreign-currency amounts to base with 2-dp rounding", () => {
    expect(toBaseAmount("100.00", "83.256789")).toBe("8325.68");
    expect(toBaseAmount("2500.00", "1")).toBe("2500.00");
  });
});
