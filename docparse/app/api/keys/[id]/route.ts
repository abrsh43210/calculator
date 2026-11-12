import { createClient } from "@/lib/supabase/server";
import { requireSessionUser } from "@/lib/auth/session";
import { errorResponse, HttpError } from "@/lib/http";

export const runtime = "nodejs";

/** DELETE -> 204. Revokes the key (soft delete; RLS limits this to the owner). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase } = await requireSessionUser(createClient);
    const { data, error } = await supabase
      .from("api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id)
      .is("revoked_at", null)
      .select("id");
    if (error) throw new HttpError(503, "db_error", "Could not revoke API key.");
    if (!data || data.length === 0) throw new HttpError(404, "not_found", "API key not found.");
    return new Response(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
