export const SITE = {
  name: "DocParse",
  routes: {
    signup: "/signup",
    login: "/login",
    docs: "/docs/api",
    pricing: "/pricing",
  },
  nav: [
    { href: "/#features", label: "Features" },
    { href: "/#how-it-works", label: "How it works" },
    { href: "/pricing", label: "Pricing" },
    { href: "/docs/api", label: "API docs" },
  ],
} as const;

/** Sign-up link that carries the chosen plan and cycle for Thread 3's checkout. */
export function signupHref(plan: string, cycle?: "monthly" | "annual"): string {
  const params = new URLSearchParams({ plan });
  if (cycle && plan !== "free") params.set("cycle", cycle);
  return `${SITE.routes.signup}?${params.toString()}`;
}
