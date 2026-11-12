import type { Metadata } from "next";
import { PricingCards } from "@/components/marketing/pricing-cards";
import { CostEstimator } from "@/components/marketing/cost-estimator";
import { Comparison } from "@/components/marketing/comparison";
import { SectionHeading } from "@/components/marketing/features";
import { Faq } from "@/components/marketing/faq";
import { FinalCta } from "@/components/marketing/cta";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "DocParse pricing: Free for 20 documents a month, Pro at $19 for 500 documents with API access, Business at $49 for 2,500 documents with webhooks.",
};

export default function PricingPage() {
  return (
    <>
      <section className="mx-auto max-w-6xl px-4 pt-20 pb-12 sm:px-6">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Pricing that costs cents, not dollars, per invoice
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Every plan includes line items, JSON and CSV export. Pay for volume, not features you will never use.
          </p>
        </div>
        <PricingCards />
      </section>
      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <SectionHeading eyebrow="Estimate" title="What will it cost you?" body="Slide to your monthly volume. We pick the cheapest plan, overage included." />
        <CostEstimator />
      </section>
      <section className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
        <SectionHeading eyebrow="Compare" title="Up to 10x cheaper per document" body="DocParse Pro includes the API at a fraction of the per-document price of other parsers." />
        <Comparison />
      </section>
      <Faq />
      <FinalCta />
    </>
  );
}
