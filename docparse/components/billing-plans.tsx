"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { formatUsd, PLANS, type Plan, type PlanId } from "@/lib/pricing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function BillingPlans({
  plans = PLANS,
  currentPlan,
  onSelect,
}: {
  plans?: readonly Plan[];
  currentPlan: PlanId;
  onSelect: (plan: PlanId) => Promise<void>;
}) {
  const [pending, setPending] = useState<PlanId | null>(null);
  const currentIdx = plans.findIndex((p) => p.id === currentPlan);

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {plans.map((p, i) => {
        const isCurrent = p.id === currentPlan;
        const label = isCurrent ? "Current plan" : i > currentIdx ? `Upgrade to ${p.name}` : `Switch to ${p.name}`;
        return (
          <Card key={p.id} data-plan={p.id} className={cn("flex flex-col", isCurrent && "border-primary ring-1 ring-primary")}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{p.name}</CardTitle>
                {isCurrent && <Badge>Current</Badge>}
              </div>
              <CardDescription>{p.tagline}</CardDescription>
              <p className="text-sm text-muted-foreground">
                <span className="text-2xl font-semibold text-foreground">{formatUsd(p.monthlyPrice)}</span> / month
              </p>
            </CardHeader>
            <CardContent className="flex-1">
              <ul className="space-y-2 text-sm">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                    {f}
                  </li>
                ))}
              </ul>
            </CardContent>
            <CardFooter>
              <Button
                className="w-full"
                variant={isCurrent ? "outline" : i > currentIdx ? "default" : "secondary"}
                disabled={isCurrent || pending !== null}
                onClick={async () => {
                  setPending(p.id);
                  try {
                    await onSelect(p.id);
                  } finally {
                    setPending(null);
                  }
                }}
              >
                {pending === p.id ? "Redirecting…" : label}
              </Button>
            </CardFooter>
          </Card>
        );
      })}
    </div>
  );
}
