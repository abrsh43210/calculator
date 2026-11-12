import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { reportPendingOverage } from "@/lib/quota";
import { errorResponse, HttpError } from "@/lib/http";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Hourly sweep (vercel.json) that sends any unreported overage to Stripe. */
export async function GET(request: NextRequest) {
  try {
    if (request.headers.get("authorization") !== `Bearer ${env.cronSecret}`) {
      throw new HttpError(401, "unauthorized", "Bad cron secret.");
    }
    const reported = await reportPendingOverage({ stripe: getStripe(), db: createAdminClient() });
    return NextResponse.json({ reported });
  } catch (err) {
    return errorResponse(err);
  }
}
