import Link from "next/link";
import { SITE } from "@/lib/site";
import { buttonVariants } from "@/components/ui/button";

export function FinalCta() {
  return (
    <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
      <div className="rounded-2xl border bg-gradient-to-br from-primary/15 via-card to-accent/10 p-10 text-center sm:p-14">
        <h2 className="text-3xl font-semibold tracking-tight text-balance">Parse your first invoice in under a minute</h2>
        <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
          Sign up, drop in a PDF, and download the JSON. 20 documents a month are free, forever.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href={`${SITE.routes.signup}?plan=free`} className={buttonVariants({ size: "lg" })}>Start free</Link>
          <Link href={SITE.routes.pricing} className={buttonVariants({ variant: "outline", size: "lg" })}>See pricing</Link>
        </div>
      </div>
    </section>
  );
}
