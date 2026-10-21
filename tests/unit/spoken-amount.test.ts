import { describe, expect, it } from "vitest";
import { parseSpokenAmount } from "@/lib/ai/parser";

const value = (s: string) => {
  const r = parseSpokenAmount(s);
  return r && "value" in r ? r.value : r;
};

describe("parseSpokenAmount", () => {
  it.each([
    ["15500", 15500],
    ["15,500", 15500],
    ["₹15,500", 15500],
    ["Rs. 2,500 only", 2500],
    ["15,500 rupees", 15500],
    ["15 thousand 500", 15500],
    ["15 thousand five hundred", 15500],
    ["fifteen thousand five hundred", 15500],
    ["fifteen thousand five hundred rupees", 15500],
    ["fifteen hundred", 1500],
    ["one thousand", 1000],
    ["a thousand", 1000],
    ["twenty five thousand", 25000],
    ["two thousand five hundred", 2500],
    ["twelve thousand three hundred and fifty", 12350],
    ["1 lakh 20 thousand", 120000],
    ["one lakh twenty thousand", 120000],
    ["1.5 lakh", 150000],
    ["two point five lakh", 250000],
    ["2.5k", 2500],
    ["15k", 15000],
    ["it was 750", 750],
    ["seventy five thousand", 75000],
    ["99.50", 99.5],
  ])("%s → %d", (input, expected) => {
    expect(value(input)).toBe(expected);
  });

  it("flags a bare scale word as ambiguous (first word was probably cut off)", () => {
    expect(parseSpokenAmount("thousand")).toEqual({ ambiguous: "bare-scale", text: "thousand" });
    expect(parseSpokenAmount("lakh rupees")).toMatchObject({ ambiguous: "bare-scale" });
  });

  it("reports separate amounts instead of adding them", () => {
    expect(parseSpokenAmount("500 and 700")).toMatchObject({ multiple: ["500", "700"] });
    expect(parseSpokenAmount("15 500")).toMatchObject({ multiple: ["15", "500"] });
  });

  it("returns null when there is no number", () => {
    expect(parseSpokenAmount("a lot")).toBeNull();
    expect(parseSpokenAmount("not sure")).toBeNull();
  });
});
