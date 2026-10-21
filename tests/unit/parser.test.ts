import { describe, expect, it } from "vitest";
import { extractAmounts, extractDate, parseTransactionText, toTransactionDraft, wordsToNumber, type ParseContext } from "@/lib/ai/parser";
import { DEFAULT_ACCOUNTS, DEFAULT_CATEGORIES } from "@/lib/accounting/coa-template";

function context(extraAccounts: { code: string; name: string; subtype: string }[] = [{ code: "BANK-HDFC", name: "HDFC Bank", subtype: "BANK" }]): ParseContext {
  const accounts = [...DEFAULT_ACCOUNTS, ...extraAccounts.map((a) => ({ ...a, type: "ASSET" as const }))].map((a, i) => ({
    id: `acc-${i}-${a.code}`,
    code: a.code,
    name: a.name,
    type: a.type,
    subtype: a.subtype ?? null,
    bankName: null,
  }));
  const idByCode = new Map(accounts.map((a) => [a.code, a.id]));
  return {
    today: "2026-10-15",
    currency: "INR",
    accounts,
    categories: DEFAULT_CATEGORIES.map((c, i) => ({ id: `cat-${i}`, name: c.name, kind: c.kind, accountId: idByCode.get(c.accountCode)!, keywords: c.keywords })),
    customers: ["ABC Technologies"],
    vendors: [],
  };
}

describe("requirement example 1 — expense", () => {
  const p = parseTransactionText("Today I spent ₹2,500 for office electricity through HDFC Bank.", context());
  it("extracts all fields", () => {
    expect(p.type).toBe("EXPENSE");
    expect(p.amount).toBe("2500.00");
    expect(p.currency).toBe("INR");
    expect(p.categoryName).toBe("Electricity Expense");
    expect(p.paymentAccountName).toBe("HDFC Bank");
    expect(p.date).toBe("2026-10-15");
    expect(p.dateAssumed).toBe(false);
    expect(p.description).toBe("Office Electricity");
    expect(p.missing).toEqual([]);
    expect(p.confidence).toBeGreaterThanOrEqual(0.9);
  });
  it("maps to Dr expense (via category) / Cr bank", () => {
    expect(toTransactionDraft(p)).toEqual({ type: "EXPENSE", debitAccountId: null, creditAccountId: p.paymentAccountId });
  });
});

describe("requirement example 2 — income", () => {
  const p = parseTransactionText("Received ₹75,000 from ABC Technologies for website development.", context());
  it("extracts type, amount, customer, category and description", () => {
    expect(p.type).toBe("INCOME");
    expect(p.amount).toBe("75000.00");
    expect(p.counterparty).toBe("ABC Technologies");
    expect(p.counterpartyRole).toBe("customer");
    expect(p.categoryName).toBe("Service Revenue");
    expect(p.description).toBe("Website Development");
  });
  it("asks which account received the money instead of guessing", () => {
    expect(p.paymentAccountId).toBeNull();
    expect(p.missing).toContain("receiving account");
    expect(p.clarifications.join(" ")).toMatch(/which account received/i);
    expect(p.confidence).toBeLessThanOrEqual(0.6);
  });
});

describe("counterparty matching", () => {
  it("only reuses an existing contact on an exact (suffix-insensitive) name match", () => {
    const ctx = { ...context(), customers: ["ABC Technologies Client Services", "Bright Solutions Pvt Ltd"] };
    expect(parseTransactionText("Received ₹75,000 from ABC Technologies for website work", ctx).counterparty).toBe("ABC Technologies");
    expect(parseTransactionText("Received ₹10,000 from Bright Solutions for support", ctx).counterparty).toBe("Bright Solutions Pvt Ltd");
  });
});

describe("clarification instead of guessing", () => {
  it("asks for the amount when none is given", () => {
    const p = parseTransactionText("Paid the electricity bill through HDFC Bank", context());
    expect(p.amount).toBeNull();
    expect(p.missing).toContain("amount");
  });
  it("asks which bank when several banks exist and none is named", () => {
    const p = parseTransactionText("Paid 1200 for internet from the bank", context([{ code: "BANK-HDFC", name: "HDFC Bank", subtype: "BANK" }]));
    expect(p.paymentAccountId).toBeNull();
    expect(p.clarifications.join(" ")).toMatch(/which bank account/i);
  });
  it("asks about ambiguous amounts", () => {
    const p = parseTransactionText("Spent ₹500 and ₹700 on snacks in cash", context());
    expect(p.amount).toBeNull();
    expect(p.missing).toContain("amount");
  });
});

describe("other patterns", () => {
  it("handles cash, yesterday and petrol", () => {
    const p = parseTransactionText("Paid 1500 for petrol yesterday by cash", context());
    expect(p).toMatchObject({ type: "EXPENSE", amount: "1500.00", date: "2026-10-14", categoryName: "Fuel", paymentAccountName: "Cash in Hand", paymentMethod: "Cash" });
  });
  it("detects transfers between own accounts", () => {
    const p = parseTransactionText("Transferred 10k from HDFC Bank to cash on 12 Oct", context());
    expect(p).toMatchObject({ type: "TRANSFER", amount: "10000.00", date: "2026-10-12", paymentAccountName: "HDFC Bank", toAccountName: "Cash in Hand" });
  });
  it("understands lakh and spelled-out numbers", () => {
    expect(extractAmounts("received 2.5 lakh")[0].value).toBe(250000);
    expect(wordsToNumber("two thousand five hundred")?.value).toBe(2500);
    const p = parseTransactionText("Paid Ramesh Electricals two thousand five hundred rupees for repairs via UPI", context());
    expect(p.amount).toBe("2500.00");
    expect(p.counterparty).toBe("Ramesh Electricals");
    expect(p.paymentMethod).toBe("UPI");
  });
  it("does not treat dates as amounts", () => {
    const amounts = extractAmounts("paid ₹900 on 15/10/2026");
    expect(amounts.map((a) => a.value)).toEqual([900]);
  });
  it("parses explicit and relative dates", () => {
    expect(extractDate("on 3rd October", "2026-10-15").date).toBe("2026-10-03");
    expect(extractDate("2026-09-30", "2026-10-15").date).toBe("2026-09-30");
    expect(extractDate("05/10/2026", "2026-10-15").date).toBe("2026-10-05");
    expect(extractDate("last monday", "2026-10-15").date).toBe("2026-10-12");
    expect(extractDate("3 days ago", "2026-10-15").date).toBe("2026-10-12");
    expect(extractDate("nothing here", "2026-10-15")).toEqual({ date: "2026-10-15", assumed: true });
  });
});
