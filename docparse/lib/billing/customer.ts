import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "@/lib/http";

export interface BillingDeps {
  stripe: Stripe;
  /** Service-role Supabase client. */
  db: SupabaseClient;
}

/**
 * Returns the user's Stripe customer id, creating the customer on first use.
 * Uses a conditional update so two concurrent checkouts can't create two
 * linked customers for the same user.
 */
export async function getOrCreateCustomer(
  deps: BillingDeps,
  user: { id: string; email: string },
): Promise<string> {
  const { data: profile, error } = await deps.db
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw new HttpError(503, "db_error", "Could not load billing profile.");
  if (!profile) throw new HttpError(404, "profile_not_found", "No profile for this user.");
  if (profile.stripe_customer_id) return profile.stripe_customer_id as string;

  const customer = await deps.stripe.customers.create(
    { email: user.email, metadata: { user_id: user.id } },
    { idempotencyKey: `customer-create-${user.id}` },
  );

  const { data: claimed, error: claimError } = await deps.db
    .from("profiles")
    .update({ stripe_customer_id: customer.id })
    .eq("id", user.id)
    .is("stripe_customer_id", null)
    .select("stripe_customer_id")
    .maybeSingle();
  if (claimError) throw new HttpError(503, "db_error", "Could not save billing profile.");
  if (claimed?.stripe_customer_id) return claimed.stripe_customer_id as string;

  // Lost a race with a parallel request; use whichever id was saved first.
  const { data: current } = await deps.db
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!current?.stripe_customer_id) {
    throw new HttpError(503, "db_error", "Could not save billing profile.");
  }
  return current.stripe_customer_id as string;
}
