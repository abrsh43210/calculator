"use client";

import { useId, useState } from "react";
import { PLANS, formatUsd, monthlyCost, recommendPlan } from "@/lib/pricing";

const MAX_DOCS = 5000;

export function CostEstimator({ initialDocs = 300 }: { initialDocs?: number }) {
  const [docs, setDocs] = useState(initialDocs);
  const id = useId();
  const { plan, cost } = recommendPlan(docs);

  return (
    <div className="rounded-2xl border bg-card p-8">
      <label htmlFor={id} className="flex items-baseline justify-between gap-4">
        <span className="font-medium">Documents per month</span>
        <span className="font-mono text-2xl" data-testid="estimator-docs">{docs.toLocaleString("en-US")}</span>
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={MAX_DOCS}
        step={50}
        value={docs}
        onChange={(e) => setDocs(Number(e.target.value))}
        className="mt-4 w-full accent-[hsl(var(--primary))]"
      />
      <p className="mt-6 text-lg" data-testid="estimator-result" aria-live="polite">
        Best fit: <strong>{plan.name}</strong> at <strong>{formatUsd(cost)}</strong>/month
        {docs > 0 && cost > 0 ? (
          <span className="text-muted-foreground"> ({formatUsd(cost / docs)} per document)</span>
        ) : null}
      </p>
      <dl className="mt-6 grid grid-cols-3 gap-4 text-sm">
        {PLANS.map((p) => {
          const c = monthlyCost(p, docs);
          return (
            <div key={p.id} className="rounded-lg border p-3">
              <dt className="text-muted-foreground">{p.name}</dt>
              <dd className="mt-1 font-medium">{c === null ? "Over limit" : formatUsd(c)}</dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
