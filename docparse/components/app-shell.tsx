"use client";

import { Menu, X } from "lucide-react";
import { useState } from "react";
import { AppNav, Logo } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      <aside className="hidden border-r bg-card/50 md:flex md:flex-col md:gap-6 md:p-4">
        <div className="px-2 pt-1">
          <Logo />
        </div>
        <AppNav />
        <div className="mt-auto rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
          Need help? <a className="text-primary hover:underline" href="mailto:support@docparse.app">Contact support</a>
        </div>
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur">
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu" onClick={() => setOpen(true)}>
            <Menu className="size-5" />
          </Button>
          <div className="md:hidden">
            <Logo />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <div className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground" aria-label="Account">
              A
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-8">{children}</main>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col gap-6 border-r bg-background p-4">
            <div className="flex items-center justify-between px-2">
              <Logo />
              <Button variant="ghost" size="icon" aria-label="Close menu" onClick={() => setOpen(false)}>
                <X className="size-5" />
              </Button>
            </div>
            <AppNav onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
