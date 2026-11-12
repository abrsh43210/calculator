import type { Usage } from "@/lib/api/types";
import { formatUsd, getPlan } from "@/lib/pricing";
import { Progress } from "@/components/ui/progress";
import { formatDate } from "@/lib/utils";

export function usageLevel(used: number, limit: number): "ok" | "warning" | "exceeded" {
  if (limit <= 0 || used >= limit) return "exceeded";
  if (used / limit >= 0.8) return "warning";
  return "ok";
}

/** True when the plan stops parsing at the limit (no overage billing). */
export function isHardCapped(usage: Usage): boolean {
  return getPlan(usage.plan).overagePerDoc === null && usageLevel(usage.docs_used, usage.docs_limit) === "exceeded";
}

export function UsageMeter({ usage }: { usage: Usage }) {
  const { docs_used: used, docs_limit: limit } = usage;
  const pct = limit > 0 ? (used / limit) * 100 : 100;
  const level = usageLevel(used, limit);
  const remaining = Math.max(0, limit - used);
  const overage = getPlan(usage.plan).overagePerDoc;
  const extra = Math.max(0, used - limit);

  let message: string;
  if (level === "exceeded") {
    message =
      overage === null
        ? "You've hit this month's limit. Upgrade to keep parsing."
        : `${extra.toLocaleString()} extra document${extra === 1 ? "" : "s"} this month, billed at ${formatUsd(overage)} each.`;
  } else if (level === "warning") {
    message = `Only ${remaining.toLocaleString()} documents left this month.`;
  } else {
    message = `${remaining.toLocaleString()} documents left this month.`;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <p className="text-2xl font-semibold tabular-nums">
          {used.toLocaleString()} <span className="text-base font-normal text-muted-foreground">/ {limit.toLocaleString()} docs</span>
        </p>
        <span className="text-xs text-muted-foreground">Resets {formatDate(usage.period_end)}</span>
      </div>
      <Progress
        value={pct}
        label="Monthly document usage"
        indicatorClassName={
          level === "exceeded" ? (overage === null ? "bg-destructive" : "bg-warning") : level === "warning" ? "bg-warning" : undefined
        }
      />
      <p className="text-sm text-muted-foreground" data-level={level}>
        {message}
      </p>
    </div>
  );
}
