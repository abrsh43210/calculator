import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "@/lib/http";

/** For dashboard routes that only accept a signed-in browser session. */
export async function requireSessionUser(getUserClient: () => Promise<SupabaseClient>) {
  const supabase = await getUserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new HttpError(401, "unauthenticated", "Sign in to continue.");
  return { supabase, user };
}
