import Link from "next/link";
import { Hero } from "@/components/marketing/hero";
import { Features, HowItWorks, SectionHeading, UseCases } from "@/components/marketing/features";
import { PricingCards } from "@/components/marketing/pricing-cards";
import { Faq } from "@/components/marketing/faq";
import { FinalCta } from "@/components/marketing/cta";

export default function LandingPage() {
  return (
    <>
      <Hero />
      <Features />
      <HowItWorks />
      <UseCases />
      <section id="pricing" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
        <SectionHeading
          eyebrow="Pricing"
          title="Simple pricing that scales with you"
          body="Start free. Upgrade when you need the API or more documents."
        />
        <PricingCards />
        <p className="mt-8 text-center text-sm">
          <Link href="/pricing" className="text-primary underline-offset-4 hover:underline">
            Compare plans and estimate your cost
          </Link>
        </p>
      </section>
      <Faq />
      <FinalCta />
    </>
  );
}
