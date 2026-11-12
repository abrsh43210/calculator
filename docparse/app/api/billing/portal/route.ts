import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { createPortal } from "@/lib/billing/checkout";
import { requireSessionUser } from "@/lib/auth/session";
import { errorResponse } from "@/lib/http";
import { env } from "@/lib/env";

export const runtime = "nodejs";

/** POST -> { url } of the Stripe Customer Portal */
export async function POST() {
  try {
    const { user } = await requireSessionUser(createClient);
    const result = await createPortal(
      { stripe: getStripe(), db: createAdminClient() },
      { user: { id: user.id, email: user.email ?? "" }, siteUrl: env.siteUrl },
    );
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
