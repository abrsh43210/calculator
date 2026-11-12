import { describe, expect, it } from "vitest";
import {
  PLANS,
  annualSavingsPercent,
  displayMonthlyPrice,
  docsForPages,
  formatUsd,
  getPlan,
  monthlyCost,
  pricePerDoc,
  recommendPlan,
} from "@/lib/pricing";

describe("plans", () => {
  it("has free, pro and business in ascending price order", () => {
    expect(PLANS.map((p) => p.id)).toEqual(["free", "pro", "business"]);
    const prices = PLANS.map((p) => p.monthlyPrice);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
  });

  it("gives every paid plan Stripe lookup keys and the free plan none", () => {
    for (const p of PLANS) {
      if (p.monthlyPrice > 0) expect(p.stripeLookupKeys).toEqual({ monthly: `${p.id}_monthly`, annual: `${p.id}_annual` });
      else expect(p.stripeLookupKeys).toBeNull();
    }
  });

  it("throws for an unknown plan", () => {
    // @ts-expect-error testing a bad id
    expect(() => getPlan("enterprise")).toThrow(/Unknown plan/);
  });
});

describe("prices", () => {
  it("divides annual price by 12", () => {
    expect(displayMonthlyPrice(getPlan("pro"), "annual")).toBeCloseTo(15.83, 2);
    expect(displayMonthlyPrice(getPlan("pro"), "monthly")).toBe(19);
  });

  it("saves 17% on annual billing", () => {
    expect(annualSavingsPercent(getPlan("pro"))).toBe(17);
    expect(annualSavingsPercent(getPlan("business"))).toBe(17);
    expect(annualSavingsPercent(getPlan("free"))).toBe(0);
  });

  it("computes price per included document", () => {
    expect(pricePerDoc(getPlan("pro"))).toBeCloseTo(0.038, 3);
    expect(pricePerDoc(getPlan("business"))).toBeCloseTo(0.0196, 4);
    expect(pricePerDoc(getPlan("free"))).toBe(0);
  });
});

describe("docsForPages", () => {
  it.each([
    [0, 0],
    [1, 1],
    [5, 1],
    [6, 2],
    [12, 3],
    [-3, 0],
    [Number.NaN, 0],
  ])("%d pages -> %d docs", (pages, docs) => {
    expect(docsForPages(pages)).toBe(docs);
  });
});

describe("monthlyCost", () => {
  it("returns base price within the allowance", () => {
    expect(monthlyCost(getPlan("pro"), 500)).toBe(19);
  });

  it("adds overage beyond the allowance", () => {
    expect(monthlyCost(getPlan("pro"), 600)).toBe(23);
    expect(monthlyCost(getPlan("business"), 3000)).toBe(61.5);
  });

  it("returns null when the free cap is exceeded", () => {
    expect(monthlyCost(getPlan("free"), 20)).toBe(0);
    expect(monthlyCost(getPlan("free"), 21)).toBeNull();
  });

  it("treats negative and fractional volume sensibly", () => {
    expect(monthlyCost(getPlan("pro"), -10)).toBe(19);
    expect(monthlyCost(getPlan("pro"), 500.2)).toBe(19.04);
  });
});

describe("recommendPlan", () => {
  it.each([
    [0, "free"],
    [20, "free"],
    [21, "pro"],
    [1000, "pro"],
    [1250, "business"], // tie at $49 goes to Business
    [1500, "business"],
    [10000, "business"],
  ])("%d docs -> %s", (docs, id) => {
    expect(recommendPlan(docs).plan.id).toBe(id);
  });
});

describe("formatUsd", () => {
  it("drops cents on whole dollars and keeps them otherwise", () => {
    expect(formatUsd(19)).toBe("$19");
    expect(formatUsd(15.83)).toBe("$15.83");
    expect(formatUsd(0.038)).toBe("$0.038");
  });
});
