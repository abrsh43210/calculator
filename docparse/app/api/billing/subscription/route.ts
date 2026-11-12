import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireSessionUser } from "@/lib/auth/session";
import { errorResponse, HttpError } from "@/lib/http";
import type { PlanId, Subscription } from "@/lib/api/types";

const SHOWN_STATUSES = new Set(["active", "trialing", "past_due", "canceled"]);

/** GET -> Subscription for the signed-in user ({ plan: "free", status: "none" } if they never paid). */
export async function GET() {
  try {
    const { supabase, user } = await requireSessionUser(createClient);

    const [{ data: profile, error: pErr }, { data: subs, error: sErr }] = await Promise.all([
      supabase.from("profiles").select("plan").eq("id", user.id).maybeSingle(),
      supabase
        .from("subscriptions")
        .select("status, current_period_end, cancel_at_period_end, updated_at")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(5),
    ]);
    if (pErr || sErr) throw new HttpError(503, "db_error", "Could not load subscription.");

    const plan = ((profile?.plan as PlanId | undefined) ?? "free") as PlanId;
    // Prefer a live subscription; otherwise show the most recent one (e.g. canceled).
    const live = (subs ?? []).find((s) => ["active", "trialing", "past_due"].includes(s.status as string));
    const latest = live ?? (subs ?? [])[0];

    const body: Subscription =
      latest && SHOWN_STATUSES.has(latest.status as string)
        ? {
            plan,
            status: latest.status as Subscription["status"],
            current_period_end: (latest.current_period_end as string) ?? null,
            cancel_at_period_end: Boolean(latest.cancel_at_period_end),
          }
        : { plan, status: "none", current_period_end: null, cancel_at_period_end: false };
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
