"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { signInWithEmail, signInWithGoogle, signUpWithEmail, type AuthState } from "@/app/auth/actions";

const ERRORS: Record<string, string> = {
  auth_callback_failed: "That sign-in link didn't work. Please try again.",
  link_invalid_or_expired: "That link is invalid or has expired.",
  oauth_failed: "Google sign-in failed. Please try again.",
};

export function AuthForm({
  mode,
  next,
  planLabel,
  error,
}: {
  mode: "login" | "signup";
  next: string;
  /** e.g. "Pro (annual)": shown on signup when a paid plan was picked. */
  planLabel?: string;
  error?: string;
}) {
  const action = mode === "login" ? signInWithEmail : signUpWithEmail;
  const [state, formAction, pending] = useActionState<AuthState, FormData>(action, undefined);
  const banner = state?.error ?? (error ? ERRORS[error] ?? "Something went wrong." : undefined);
  const switchQs = new URLSearchParams({ next }).toString();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{mode === "login" ? "Sign in" : "Create your account"}</CardTitle>
        <CardDescription>
          {mode === "signup"
            ? planLabel
              ? `You'll go to checkout for ${planLabel} next.`
              : "20 free documents a month. No card needed."
            : "Welcome back."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form action={signInWithGoogle}>
          <input type="hidden" name="next" value={next} />
          <Button type="submit" variant="outline" className="w-full">
            Continue with Google
          </Button>
        </form>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          or
          <span className="h-px flex-1 bg-border" />
        </div>

        <form action={formAction} className="space-y-3">
          <input type="hidden" name="next" value={next} />
          {mode === "signup" && (
            <Input name="full_name" placeholder="Full name (optional)" autoComplete="name" />
          )}
          <Input name="email" type="email" placeholder="you@company.com" autoComplete="email" required />
          <Input
            name="password"
            type="password"
            placeholder="Password (8+ characters)"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={8}
            required
          />
          {banner && (
            <p role="alert" className="text-sm text-destructive">
              {banner}
            </p>
          )}
          {state?.message && (
            <p role="status" className="text-sm text-muted-foreground">
              {state.message}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          {mode === "login" ? (
            <>
              New to DocParse? <Link href={`/signup?${switchQs}`} className="underline">Create an account</Link>
            </>
          ) : (
            <>
              Already have an account? <Link href={`/login?${switchQs}`} className="underline">Sign in</Link>
            </>
          )}
        </p>
      </CardContent>
    </Card>
  );
}
