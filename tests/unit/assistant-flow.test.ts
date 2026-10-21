import { describe, expect, it } from "vitest";
import { clearField, interpret, needsApproval, nextStep, question, summary, toTransactionInput, type AssistantContext, type Draft } from "@/components/assistant/flow";
import { parseTypeAnswer, isSkipAnswer, parseYesNo } from "@/lib/ai/parser";

const ctx: AssistantContext = {
  today: "2026-10-15",
  currency: "INR",
  workspaceName: "Test Co",
  accounts: [
    { id: "bank", code: "BANK-HDFC", name: "HDFC Bank", type: "ASSET", subtype: "BANK" },
    { id: "cash", code: "CASH", name: "Cash in Hand", type: "ASSET", subtype: "CASH" },
    { id: "upi", code: "WALLET-UPI", name: "UPI / Digital Wallet", type: "ASSET", subtype: "WALLET" },
    { id: "card", code: "CREDIT-CARD", name: "Company Credit Card", type: "LIABILITY", subtype: "CREDIT_CARD" },
  ],
  categories: [
    { id: "elec", name: "Electricity Expense", kind: "EXPENSE", accountId: "x1", keywords: ["electricity", "power bill"] },
    { id: "fuel", name: "Fuel", kind: "EXPENSE", accountId: "x2", keywords: ["petrol", "diesel", "fuel"] },
    { id: "svc", name: "Service Revenue", kind: "INCOME", accountId: "x3", keywords: ["service", "website", "development"] },
  ],
  customers: ["ABC Technologies"],
  vendors: ["Tata Power"],
  canPost: true,
  approval: { required: false, threshold: "100000.00" },
};

function run(answers: string[]): Draft {
  let d: Draft = {};
  for (const a of answers) {
    const step = nextStep(d);
    const r = interpret(step, a, d, ctx);
    if (!r.ok) throw new Error(`${step}: ${r.retry}`);
    d = { ...d, ...r.patch };
  }
  return d;
}

describe("interactive assistant flow", () => {
  it("walks an expense through every question in order", () => {
    let d: Draft = {};
    const asked: string[] = [];
    const answers = ["expense", "2,500 rupees", "today", "office electricity", "HDFC", "Tata Power", "skip"];
    for (const a of answers) {
      const s = nextStep(d);
      asked.push(s);
      const r = interpret(s, a, d, ctx);
      expect(r.ok, `${s} should accept "${a}"`).toBe(true);
      if (r.ok) d = { ...d, ...r.patch };
    }
    expect(asked).toEqual(["type", "amount", "date", "category", "account", "counterparty", "description"]);
    expect(nextStep(d)).toBe("confirm");
    expect(d).toMatchObject({ type: "EXPENSE", amount: "2500.00", date: "2026-10-15", categoryId: "elec", fromAccountId: "bank", counterparty: "Tata Power", description: "Office Electricity" });
    expect(summary(d, ctx)).toBe("An expense of ₹2,500 today for Electricity Expense, paid from HDFC Bank, to Tata Power.");
    expect(toTransactionInput(d, ctx)).toEqual({
      type: "EXPENSE",
      date: "2026-10-15",
      amount: "2500.00",
      description: "Office Electricity",
      categoryId: "elec",
      paymentMethod: "Bank Transfer",
      creditAccountId: "bank",
      vendorName: "Tata Power",
    });
  });

  it("builds income with the receiving account as the debit side", () => {
    const d = run(["I received money", "75000", "yesterday", "website development", "HDFC Bank", "ABC Technologies", "Website project"]);
    expect(toTransactionInput(d, ctx)).toMatchObject({ type: "INCOME", debitAccountId: "bank", categoryId: "svc", customerName: "ABC Technologies", date: "2026-10-14", description: "Website project" });
  });

  it("handles transfers without category or contact questions", () => {
    const d = run(["transfer", "10k", "today", "HDFC", "cash", "skip"]);
    expect(d).toMatchObject({ type: "TRANSFER", amount: "10000.00", fromAccountId: "bank", toAccountId: "cash" });
    expect(toTransactionInput(d, ctx)).toMatchObject({ debitAccountId: "cash", creditAccountId: "bank", paymentMethod: "Transfer" });
  });

  it("fills several answers from one full sentence", () => {
    const r = interpret("type", "I spent 1500 on petrol yesterday by cash", {}, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.patch).toMatchObject({ type: "EXPENSE", amount: "1500.00", date: "2026-10-14", categoryId: "fuel", fromAccountId: "cash" });
      expect(nextStep({ ...r.patch })).toBe("counterparty");
    }
  });

  it("re-asks instead of guessing", () => {
    expect(interpret("type", "hmm not sure", {}, ctx).ok).toBe(false);
    expect(interpret("amount", "a lot", { type: "EXPENSE" }, ctx).ok).toBe(false);
    expect(interpret("amount", "500 and 700", { type: "EXPENSE" }, ctx).ok).toBe(false);
    expect(interpret("date", "sometime", { type: "EXPENSE" }, ctx).ok).toBe(false);
    expect(interpret("date", "20 December 2026", { type: "EXPENSE" }, ctx).ok).toBe(false);
    expect(interpret("category", "spaceship parts", { type: "EXPENSE" }, ctx).ok).toBe(false);
    expect(interpret("account", "the office safe", { type: "EXPENSE" }, ctx).ok).toBe(false);
  });

  it("keeps income away from card/payable accounts and transfers away from the same account", () => {
    expect(question("account", { type: "INCOME" }, ctx).chips.map((c) => c.label)).not.toContain("Company Credit Card");
    expect(question("toAccount", { type: "TRANSFER", fromAccountId: "bank" }, ctx).chips.map((c) => c.label)).not.toContain("HDFC Bank");
  });

  it("clears a field (and dependents) when the user wants to change it", () => {
    const d = run(["expense", "2500", "today", "electricity", "HDFC", "skip", "skip"]);
    expect(nextStep(clearField(d, "amount"))).toBe("amount");
    const retyped = clearField(d, "type");
    expect(retyped.categoryId).toBeUndefined();
    expect(retyped.amount).toBe("2500.00");
  });

  it("understands amounts the way speech recognition writes them", () => {
    const amount = (a: string) => {
      const r = interpret("amount", a, { type: "EXPENSE" }, ctx);
      return r.ok ? r.patch.amount : r.retry;
    };
    expect(amount("15 thousand 500")).toBe("15500.00");
    expect(amount("fifteen thousand five hundred")).toBe("15500.00");
    expect(amount("₹15,500")).toBe("15500.00");
    expect(amount("one lakh")).toBe("100000.00");
    expect(amount("thousand")).toMatch(/I only heard “thousand”/);
    expect(amount("500 and 700")).toMatch(/more than one number/);
  });

  it("flags amounts that need approval", () => {
    expect(needsApproval({ amount: "150000.00" }, ctx)).toBe(true);
    expect(needsApproval({ amount: "2500.00" }, ctx)).toBe(false);
  });

  it("understands short answers", () => {
    expect(parseTypeAnswer("money came in, income")).toBe("INCOME");
    expect(parseTypeAnswer("I paid")).toBe("EXPENSE");
    expect(isSkipAnswer("skip")).toBe(true);
    expect(isSkipAnswer("Tata Power")).toBe(false);
    expect(parseYesNo("yes please save it")).toBe(true);
    expect(parseYesNo("no, change the amount")).toBe(false);
  });
});
