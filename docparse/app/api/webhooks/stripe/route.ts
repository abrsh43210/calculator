import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { env } from "@/lib/env";
import { processStripeWebhook } from "./handler";

// Needs the raw body and Node crypto.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return processStripeWebhook(request, {
    stripe: getStripe(),
    db: createAdminClient(),
    webhookSecret: env.stripeWebhookSecret,
  });
}
