import Link from "next/link";
import { ArrowRight, FileText } from "lucide-react";
import { HERO, SAMPLE_OUTPUT } from "@/lib/copy";
import { SITE } from "@/lib/site";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-40 mx-auto h-80 max-w-3xl rounded-full bg-primary/20 blur-3xl"
      />
      <div className="relative mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:items-center lg:py-28">
        <div>
          <p className="mb-4 inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground">
            {HERO.eyebrow}
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
            {HERO.title}
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted-foreground text-pretty">{HERO.subtitle}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href={`${SITE.routes.signup}?plan=free`} className={buttonVariants({ size: "lg" })}>
              {HERO.primaryCta}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link href={SITE.routes.docs} className={buttonVariants({ variant: "outline", size: "lg" })}>
              {HERO.secondaryCta}
            </Link>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">{HERO.reassurance}</p>
        </div>
        <ExtractionDemo />
      </div>
    </section>
  );
}

function ExtractionDemo() {
  return (
    <div className="relative" aria-label="Example: an invoice converted to JSON">
      <div className="rounded-xl border bg-card shadow-2xl shadow-primary/5">
        <div className="flex items-center justify-between border-b px-4 py-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-2">
            <FileText className="size-4" aria-hidden />
            northwind-inv-20418.pdf
          </span>
          <span className="rounded-full bg-primary/15 px-2 py-0.5 font-medium text-primary">Extracted in 2.4s</span>
        </div>
        <pre className={cn("max-h-[26rem] overflow-auto p-4 font-mono text-xs leading-relaxed sm:text-sm")}>
          <code>{JSON.stringify(SAMPLE_OUTPUT, null, 2)}</code>
        </pre>
      </div>
    </div>
  );
}
