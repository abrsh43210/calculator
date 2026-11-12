import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { handleStripeEvent, RetryableWebhookError } from "@/lib/billing/webhook";

export interface WebhookRouteDeps {
  stripe: Stripe;
  db: SupabaseClient;
  webhookSecret: string;
}

/**
 * Framework-light webhook handler so it can be unit-tested with a real
 * signed payload. 400 = bad signature (Stripe won't retry usefully),
 * 500 = transient failure (Stripe retries with backoff), 200 otherwise.
 */
export async function processStripeWebhook(request: Request, deps: WebhookRouteDeps): Promise<Response> {
  const signature = request.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "missing stripe-signature header" }, { status: 400 });

  const payload = await request.text();
  let event: Stripe.Event;
  try {
    event = await deps.stripe.webhooks.constructEventAsync(payload, signature, deps.webhookSecret);
  } catch (err) {
    console.warn("[docparse] stripe signature verification failed", (err as Error).message);
    return Response.json({ error: "invalid signature" }, { status: 400 });
  }

  try {
    const outcome = await handleStripeEvent({ stripe: deps.stripe, db: deps.db }, event);
    return Response.json({ received: true, ...outcome });
  } catch (err) {
    const retryable = err instanceof RetryableWebhookError;
    console.error("[docparse] stripe webhook failed", { id: event.id, type: event.type, retryable, err });
    return Response.json({ error: "webhook handler failed" }, { status: 500 });
  }
}
