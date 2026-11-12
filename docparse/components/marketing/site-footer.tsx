import Link from "next/link";
import { Logo } from "./site-header";
import { SITE } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex flex-col gap-2">
          <Logo />
          <p>Invoices and receipts to JSON or CSV.</p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
          <Link href={SITE.routes.pricing} className="hover:text-foreground">Pricing</Link>
          <Link href={SITE.routes.docs} className="hover:text-foreground">API docs</Link>
          <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
          <Link href="/terms" className="hover:text-foreground">Terms</Link>
        </nav>
        <p>© {new Date().getFullYear()} DocParse</p>
      </div>
    </footer>
  );
}
