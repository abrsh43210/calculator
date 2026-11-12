"use client";

import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import {
  PLANS,
  annualSavingsPercent,
  displayMonthlyPrice,
  formatUsd,
  type BillingCycle,
} from "@/lib/pricing";
import { signupHref } from "@/lib/site";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function BillingToggle({ cycle, onChange }: { cycle: BillingCycle; onChange: (c: BillingCycle) => void }) {
  const savings = annualSavingsPercent(PLANS.find((p) => p.monthlyPrice > 0)!);
  return (
    <div role="radiogroup" aria-label="Billing cycle" className="inline-flex rounded-lg border bg-muted/50 p-1 text-sm">
      {(["monthly", "annual"] as const).map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={cycle === c}
          onClick={() => onChange(c)}
          className={cn(
            "rounded-md px-4 py-1.5 font-medium transition-colors",
            cycle === c ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {c === "monthly" ? "Monthly" : `Annual (save ${savings}%)`}
        </button>
      ))}
    </div>
  );
}

export function PricingCards({ initialCycle = "monthly" }: { initialCycle?: BillingCycle }) {
  const [cycle, setCycle] = useState<BillingCycle>(initialCycle);

  return (
    <div>
      <div className="mb-10 flex justify-center">
        <BillingToggle cycle={cycle} onChange={setCycle} />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        {PLANS.map((plan) => {
          const price = displayMonthlyPrice(plan, cycle);
          return (
            <article
              key={plan.id}
              aria-labelledby={`plan-${plan.id}`}
              data-testid={`plan-${plan.id}`}
              className={cn(
                "relative flex flex-col rounded-2xl border bg-card p-8",
                plan.highlighted && "border-primary shadow-xl shadow-primary/10",
              )}
            >
              {plan.highlighted ? (
                <span className="absolute -top-3 left-8 rounded-full bg-primary px-3 py-0.5 text-xs font-medium text-primary-foreground">
                  Most popular
                </span>
              ) : null}
              <h3 id={`plan-${plan.id}`} className="text-lg font-semibold">{plan.name}</h3>
              <p className="mt-1 min-h-10 text-sm text-muted-foreground">{plan.tagline}</p>
              <p className="mt-6 flex items-baseline gap-1">
                <span className="text-4xl font-semibold tracking-tight" data-testid={`price-${plan.id}`}>
                  {formatUsd(price)}
                </span>
                <span className="text-sm text-muted-foreground">/month</span>
              </p>
              <p className="mt-1 h-5 text-xs text-muted-foreground">
                {plan.monthlyPrice === 0
                  ? "Free forever"
                  : cycle === "annual"
                    ? `${formatUsd(plan.annualPrice)} billed yearly`
                    : "Billed monthly, cancel any time"}
              </p>
              <Link
                href={signupHref(plan.id, cycle)}
                className={cn(buttonVariants({ variant: plan.highlighted ? "default" : "outline" }), "mt-6 w-full")}
              >
                {plan.cta}
              </Link>
              <ul className="mt-8 space-y-3 text-sm">
                {plan.features.map((f) => (
                  <li key={f} className="flex gap-3">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>
      <p className="mt-6 text-center text-xs text-muted-foreground">
        A document is one file of up to 5 pages. Prices in USD, taxes may apply.
      </p>
    </div>
  );
}
