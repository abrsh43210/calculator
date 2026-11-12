import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";
import { nextAfterAuth } from "@/lib/auth/next-after-auth";

export const metadata: Metadata = { title: "Create account · DocParse" };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { next, planLabel } = nextAfterAuth(params);
  const error = typeof params.error === "string" ? params.error : undefined;
  return <AuthForm mode="signup" next={next} planLabel={planLabel} error={error} />;
}
