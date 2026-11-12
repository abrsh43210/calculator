import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSessionUser } from "@/lib/auth/session";
import { createApiKey } from "@/lib/api-keys";
import { errorResponse, HttpError } from "@/lib/http";
import type { ApiKey, CreatedApiKey } from "@/lib/api/types";

export const runtime = "nodejs";

/** GET -> ApiKey[] (active keys only; never includes the secret) */
export async function GET() {
  try {
    const { supabase } = await requireSessionUser(createClient);
    const { data, error } = await supabase
      .from("api_keys")
      .select("id, name, prefix, created_at, last_used_at")
      .is("revoked_at", null)
      .order("created_at", { ascending: false });
    if (error) throw new HttpError(503, "db_error", "Could not load API keys.");
    return NextResponse.json((data ?? []) as ApiKey[]);
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST { name } -> CreatedApiKey. `secret` is returned once and never stored. */
export async function POST(request: NextRequest) {
  try {
    const { user } = await requireSessionUser(createClient);
    const body = (await request.json().catch(() => ({}))) as { name?: unknown };
    const name = typeof body.name === "string" && body.name.trim() ? body.name : "Default";
    const { key, record } = await createApiKey(createAdminClient(), user.id, name);
    const created: CreatedApiKey = {
      id: record.id,
      name: record.name,
      prefix: record.prefix,
      created_at: record.created_at,
      last_used_at: record.last_used_at,
      secret: key,
    };
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
