import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { nextAfterAuth } from "@/lib/auth/next-after-auth";

const PROTECTED_PREFIXES = ["/dashboard", "/documents", "/api-keys", "/billing", "/settings"];
const AUTH_PAGES = ["/login", "/signup"];

/**
 * Refreshes the Supabase session cookie on every request and gates
 * protected pages. API routes do their own auth (they may use API keys).
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  // Supabase not configured (local dev on Thread 2's mock services): nothing to refresh or gate.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return response;

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Do not put code between createServerClient and getUser(): it refreshes the token.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;

  if (!user && PROTECTED_PREFIXES.some((p) => pathname.startsWith(p))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  if (user && AUTH_PAGES.includes(pathname)) {
    // Already signed in: continue to checkout (paid plan picked) or the dashboard.
    const { next } = nextAfterAuth(Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.redirect(new URL(next, request.url));
  }

  return response;
}
