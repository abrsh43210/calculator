import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fireEvent } from "@testing-library/react";
import { PricingCards } from "@/components/marketing/pricing-cards";
import { CostEstimator } from "@/components/marketing/cost-estimator";
import LandingPage from "@/app/(marketing)/page";
import PricingPage from "@/app/(marketing)/pricing/page";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

describe("PricingCards", () => {
  it("shows monthly prices by default", () => {
    render(<PricingCards />);
    expect(screen.getByTestId("price-free")).toHaveTextContent("$0");
    expect(screen.getByTestId("price-pro")).toHaveTextContent("$19");
    expect(screen.getByTestId("price-business")).toHaveTextContent("$49");
  });

  it("switches to annual prices and updates signup links", async () => {
    render(<PricingCards />);
    await userEvent.click(screen.getByRole("radio", { name: /annual/i }));
    expect(screen.getByRole("radio", { name: /annual/i })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("price-pro")).toHaveTextContent("$15.83");
    expect(screen.getByTestId("price-business")).toHaveTextContent("$40.83");
    const pro = screen.getByTestId("plan-pro");
    expect(within(pro).getByRole("link", { name: "Start Pro" })).toHaveAttribute(
      "href",
      "/signup?plan=pro&cycle=annual",
    );
    expect(within(screen.getByTestId("plan-free")).getByRole("link")).toHaveAttribute("href", "/signup?plan=free");
  });
});

describe("CostEstimator", () => {
  it("recommends Pro for 300 docs and Business for 2000", () => {
    render(<CostEstimator initialDocs={300} />);
    expect(screen.getByTestId("estimator-result")).toHaveTextContent("Best fit: Pro at $19/month");
    fireEvent.change(screen.getByRole("slider"), { target: { value: "2000" } });
    expect(screen.getByTestId("estimator-docs")).toHaveTextContent("2,000");
    expect(screen.getByTestId("estimator-result")).toHaveTextContent("Best fit: Business at $49/month");
  });

  it("shows the free plan as over limit above 20 docs", () => {
    render(<CostEstimator initialDocs={100} />);
    expect(screen.getByText("Over limit")).toBeInTheDocument();
  });
});

describe("pages", () => {
  it("renders the landing page with a single h1 and the main sections", () => {
    render(<LandingPage />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Invoices in. Clean JSON out.");
    for (const name of [/everything on the page/i, /three steps/i, /simple pricing/i, /questions, answered/i]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
  });

  it("renders the pricing page with estimator and comparison table", () => {
    render(<PricingPage />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("slider")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "DocParse Pro" })).toBeInTheDocument();
  });
});
