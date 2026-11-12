"use client";

import { ExternalLink } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { api } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import type { PlanId } from "@/lib/api/types";
import { useAsync } from "@/lib/use-async";
import { formatDate } from "@/lib/utils";
import { BillingPlans } from "@/components/billing-plans";
import { PageHeader } from "@/components/page-header";
import { UsageMeter } from "@/components/usage-meter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function BillingPage() {
  return (
    <Suspense>
      <BillingView />
    </Suspense>
  );
}

function BillingView() {
  const params = useSearchParams();
  const sub = useAsync(() => api.getSubscription());
  const usage = useAsync(() => api.getUsage());
  const [error, setError] = useState<string | null>(null);

  const go = (url: string) => {
    window.location.assign(url);
  };

  const select = async (plan: PlanId) => {
    setError(null);
    try {
      const { url } = await api.startCheckout(plan);
      go(url);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const portal = async () => {
    setError(null);
    try {
      const { url } = await api.openBillingPortal();
      go(url);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <>
      <PageHeader title="Billing" description="Change your plan or update payment details. Payments are handled securely by Stripe.">
        <Button variant="outline" onClick={portal}>
          <ExternalLink className="size-4" /> Manage payment method
        </Button>
      </PageHeader>

      {params.get("checkout") === "success" && (
        <div role="status" className="mb-6 rounded-lg border border-success/40 bg-success/10 p-4 text-sm">
          Payment received and your plan is active. Thanks for subscribing!
        </div>
      )}
      {params.get("checkout") === "updated" && (
        <div role="status" className="mb-6 rounded-lg border border-success/40 bg-success/10 p-4 text-sm">
          Your plan was changed. Stripe prorates the difference on your next invoice.
        </div>
      )}
      {error && (
        <p role="alert" className="mb-6 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Current usage</CardTitle>
            <CardDescription>
              {sub.data?.current_period_end
                ? `${sub.data.cancel_at_period_end ? "Ends" : "Renews"} ${formatDate(sub.data.current_period_end)}`
                : " "}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {usage.data ? <UsageMeter usage={usage.data} /> : <div className="h-20 animate-pulse rounded-md bg-muted" />}
          </CardContent>
        </Card>

        {sub.error ? (
          <p role="alert" className="text-sm text-destructive">{sub.error}</p>
        ) : sub.data ? (
          <BillingPlans currentPlan={sub.data.plan} onSelect={select} />
        ) : (
          <div className="h-72 animate-pulse rounded-xl bg-muted" />
        )}
      </div>
    </>
  );
}
