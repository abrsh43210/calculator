import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";
import { nextAfterAuth } from "@/lib/auth/next-after-auth";

export const metadata: Metadata = { title: "Sign in · DocParse" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { next } = nextAfterAuth(params);
  const error = typeof params.error === "string" ? params.error : undefined;
  return <AuthForm mode="login" next={next} error={error} />;
}
