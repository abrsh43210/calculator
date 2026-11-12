import type { Metadata } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: {
    default: "DocParse: invoices and receipts to JSON or CSV",
    template: "%s | DocParse",
  },
  description:
    "Turn invoices and receipts (PDF or image) into clean JSON or CSV in seconds. No templates. Web app and REST API. Free for 20 documents a month.",
  openGraph: {
    title: "DocParse: invoices and receipts to JSON or CSV",
    description: "Upload a PDF or photo, get structured data back. No templates to train.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen font-sans">
        {/* Dark by default; the toggle in the app header switches to light and persists it. */}
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
