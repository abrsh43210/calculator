import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { createCheckout } from "@/lib/billing/checkout";
import { HttpError } from "@/lib/http";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /checkout?plan=pro&cycle=annual
 * Link target for pricing buttons and the post-signup redirect. Sends a
 * signed-out visitor to /signup (keeping plan and cycle), otherwise redirects
 * straight to Stripe Checkout (or the Portal if they already subscribe).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const plan = searchParams.get("plan");
  const cycle = searchParams.get("cycle") ?? "monthly";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const qs = new URLSearchParams({ plan: plan ?? "", cycle });
    return NextResponse.redirect(`${origin}/signup?${qs}`, 303);
  }
  if (plan === "free" || !plan) return NextResponse.redirect(`${origin}/dashboard`, 303);

  try {
    const { url } = await createCheckout(
      { stripe: getStripe(), db: createAdminClient() },
      { user: { id: user.id, email: user.email ?? "" }, plan, cycle, siteUrl: env.siteUrl },
    );
    return NextResponse.redirect(url, 303);
  } catch (err) {
    const code = err instanceof HttpError ? err.code : "checkout_failed";
    if (!(err instanceof HttpError)) console.error("[docparse] checkout redirect failed", err);
    return NextResponse.redirect(`${origin}/pricing?error=${code}`, 303);
  }
}
