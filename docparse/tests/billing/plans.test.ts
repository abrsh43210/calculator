// @vitest-environment node
import {
  baseLookupKey,
  hasApiAccess,
  hasOverage,
  highestPlan,
  includedDocs,
  isOverageLookupKey,
  planFromLookupKey,
} from "@/lib/billing/plans";
import { safeNextPath } from "@/lib/http";
import { nextAfterAuth } from "@/lib/auth/next-after-auth";

describe("billing plans (built on lib/pricing.ts)", () => {
  it("maps plan + cycle to Thread 1's lookup keys and back", () => {
    expect(baseLookupKey("pro", "monthly")).toBe("pro_monthly");
    expect(baseLookupKey("business", "annual")).toBe("business_annual");
    expect(planFromLookupKey("pro_annual")).toEqual({ plan: "pro", cycle: "annual" });
    expect(planFromLookupKey("business_monthly")).toEqual({ plan: "business", cycle: "monthly" });
    expect(planFromLookupKey("pro_overage")).toBeNull();
    expect(planFromLookupKey(null)).toBeNull();
    expect(isOverageLookupKey("business_overage")).toBe(true);
    expect(isOverageLookupKey("pro_monthly")).toBe(false);
  });

  it("matches the DB's plan_doc_limit and overage rules", () => {
    expect(includedDocs("free")).toBe(20);
    expect(includedDocs("pro")).toBe(500);
    expect(includedDocs("business")).toBe(2500);
    expect(hasOverage("free")).toBe(false);
    expect(hasOverage("pro")).toBe(true);
  });

  it("gives API access on Pro and Business only", () => {
    expect(hasApiAccess("free")).toBe(false);
    expect(hasApiAccess("pro")).toBe(true);
    expect(hasApiAccess("business")).toBe(true);
  });

  it("picks the highest plan", () => {
    expect(highestPlan([])).toBe("free");
    expect(highestPlan(["pro", "business", "free"])).toBe("business");
  });
});

describe("redirect safety", () => {
  it("only allows same-site relative paths", () => {
    expect(safeNextPath("/documents?x=1")).toBe("/documents?x=1");
    expect(safeNextPath("https://evil.test")).toBe("/dashboard");
    expect(safeNextPath("//evil.test")).toBe("/dashboard");
    expect(safeNextPath("/\\evil.test")).toBe("/dashboard");
    expect(safeNextPath(null)).toBe("/dashboard");
  });

  it("sends paid signups to checkout with their cycle", () => {
    expect(nextAfterAuth({ plan: "pro", cycle: "annual" })).toEqual({
      next: "/checkout?plan=pro&cycle=annual",
      planLabel: "Pro (annual)",
    });
    expect(nextAfterAuth({ plan: "business", cycle: "weird" }).next).toBe("/checkout?plan=business&cycle=monthly");
    expect(nextAfterAuth({ plan: "free" }).next).toBe("/dashboard");
    expect(nextAfterAuth({ next: "/billing" }).next).toBe("/billing");
    expect(nextAfterAuth({ next: "https://evil.test" }).next).toBe("/dashboard");
  });
});
