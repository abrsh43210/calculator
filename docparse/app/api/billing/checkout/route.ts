import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { createCheckout } from "@/lib/billing/checkout";
import { requireSessionUser } from "@/lib/auth/session";
import { errorResponse, HttpError } from "@/lib/http";
import { env } from "@/lib/env";

export const runtime = "nodejs";

/** POST { plan: "pro" | "business", cycle?: "monthly" | "annual" } -> { url, kind } */
export async function POST(request: NextRequest) {
  try {
    const { user } = await requireSessionUser(createClient);
    if (!user.email) throw new HttpError(400, "email_required", "Your account needs an email address.");

    const body = (await request.json().catch(() => ({}))) as { plan?: unknown; cycle?: unknown };
    const result = await createCheckout(
      { stripe: getStripe(), db: createAdminClient() },
      { user: { id: user.id, email: user.email }, plan: body.plan, cycle: body.cycle, siteUrl: env.siteUrl },
    );
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
