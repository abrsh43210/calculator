import { Code2, FileSpreadsheet, Gauge, ListTree, ShieldCheck, Sparkles, type LucideIcon } from "lucide-react";
import { FEATURES, STEPS, USE_CASES } from "@/lib/copy";

const ICONS: Record<string, LucideIcon> = { Code2, FileSpreadsheet, Gauge, ListTree, ShieldCheck, Sparkles };

export function SectionHeading({ eyebrow, title, body }: { eyebrow: string; title: string; body?: string }) {
  return (
    <div className="mx-auto mb-12 max-w-2xl text-center">
      <p className="text-sm font-medium text-primary">{eyebrow}</p>
      <h2 className="mt-2 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{title}</h2>
      {body ? <p className="mt-4 text-muted-foreground text-pretty">{body}</p> : null}
    </div>
  );
}

export function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
      <SectionHeading
        eyebrow="Features"
        title="Everything on the page, in the shape you need"
        body="Built for the boring, high-volume documents that eat your month end."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => {
          const Icon = ICONS[f.icon];
          return (
            <div key={f.title} className="rounded-xl border bg-card p-6">
              <span className="mb-4 grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-5" aria-hidden />
              </span>
              <h3 className="font-medium">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-20 border-y bg-muted/40">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <SectionHeading eyebrow="How it works" title="Three steps, a few seconds" />
        <ol className="grid gap-6 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="rounded-xl border bg-card p-6">
              <span className="font-mono text-sm text-primary">0{i + 1}</span>
              <h3 className="mt-2 text-lg font-medium">{s.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
            </li>
          ))}
        </ol>
        <div className="mt-10 overflow-hidden rounded-xl border bg-card">
          <div className="border-b px-4 py-2 text-xs text-muted-foreground">Or call the API</div>
          <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed sm:text-sm">
            <code>{`curl https://api.docparse.dev/v1/extract \\
  -H "Authorization: Bearer $DOCPARSE_API_KEY" \\
  -F file=@invoice.pdf \\
  -F format=json`}</code>
          </pre>
        </div>
      </div>
    </section>
  );
}

export function UseCases() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <SectionHeading eyebrow="Who it's for" title="Less typing, fewer mistakes" />
      <div className="grid gap-4 md:grid-cols-3">
        {USE_CASES.map((u) => (
          <div key={u.title} className="rounded-xl border p-6">
            <h3 className="font-medium">{u.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{u.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
