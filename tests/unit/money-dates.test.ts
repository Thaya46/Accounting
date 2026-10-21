import { describe, expect, it } from "vitest";
import { dec, formatMoney, money2, parseAmountInput, sumDec } from "@/lib/money";
import { addDays, financialYearFor, financialYearRange, formatDate, parseISODate, todayInTimeZone } from "@/lib/dates";
import { txnRef, userRef, workspaceRef } from "@/lib/ids";

describe("money", () => {
  it("uses fixed 2-dp decimal strings without float error", () => {
    expect(money2("0.1")).toBe("0.10");
    expect(sumDec(["0.1", "0.2"]).toFixed(2)).toBe("0.30");
    expect(money2(dec("2500").times("1.18"))).toBe("2950.00");
    expect(money2("1.005")).toBe("1.01");
  });
  it("formats INR in the Indian numbering system", () => {
    expect(formatMoney("15000", "INR")).toBe("₹15,000");
    expect(formatMoney("150000", "INR")).toBe("₹1,50,000");
    expect(formatMoney("2500.5", "INR")).toBe("₹2,500.50");
  });
  it("parses user-entered amounts", () => {
    expect(parseAmountInput("₹2,500.50")).toBe("2500.50");
    expect(parseAmountInput("abc")).toBeNull();
  });
});

describe("dates", () => {
  it("validates calendar dates", () => {
    expect(() => parseISODate("2026-02-30")).toThrow();
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("computes Indian financial years (April–March)", () => {
    expect(financialYearFor("2026-10-15", 4)).toMatchObject({ from: "2026-04-01", to: "2027-03-31", label: "FY 2026-27" });
    expect(financialYearFor("2026-02-01", 4)).toMatchObject({ from: "2025-04-01", to: "2026-03-31" });
    expect(financialYearRange(2026, 1)).toMatchObject({ from: "2026-01-01", to: "2026-12-31", label: "FY 2026" });
  });
  it("formats display dates like the specification", () => {
    expect(formatDate("2026-10-15")).toBe("15 Oct 2026");
  });
  it("resolves today in the workspace time zone", () => {
    expect(todayInTimeZone("Asia/Kolkata", new Date("2026-10-14T20:00:00Z"))).toBe("2026-10-15");
    expect(todayInTimeZone("America/New_York", new Date("2026-10-15T02:00:00Z"))).toBe("2026-10-14");
  });
});

describe("references", () => {
  it("formats human-readable IDs", () => {
    expect(workspaceRef(1)).toBe("WS-001");
    expect(userRef(7)).toBe("USR-007");
    expect(txnRef(1)).toBe("TXN-0001");
  });
});
