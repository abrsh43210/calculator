import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { UploadDropzone } from "@/components/upload-dropzone";
import { ResultViewer } from "@/components/result-viewer";
import { isHardCapped, UsageMeter, usageLevel } from "@/components/usage-meter";
import { DocumentList } from "@/components/document-list";
import { ApiKeysManager } from "@/components/api-keys-manager";
import { BillingPlans } from "@/components/billing-plans";
import { StatusBadge } from "@/components/status-badge";
import { PLANS } from "@/lib/pricing";
import { ApiError } from "@/lib/api/errors";
import type { DocumentRecord, ExtractionResult } from "@/lib/api/types";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));

const result: ExtractionResult = {
  document_type: "invoice",
  vendor: { name: "Northwind", address: null, tax_id: null },
  customer: { name: "Acme", address: null, tax_id: null },
  invoice_number: "INV-9",
  issue_date: "2026-11-02",
  due_date: null,
  currency: "USD",
  subtotal: 100,
  tax: 10,
  total: 110,
  line_items: [{ description: "Chair", quantity: 1, unit_price: 100, amount: 100 }],
  confidence: 0.8,
};
const doc: DocumentRecord & { result: ExtractionResult } = {
  id: "doc_1",
  filename: "inv.pdf",
  mime_type: "application/pdf",
  size_bytes: 2048,
  status: "completed",
  created_at: "2026-11-02T00:00:00Z",
  completed_at: "2026-11-02T00:00:02Z",
  result,
  error: null,
};

describe("UploadDropzone", () => {
  it("uploads valid files and reports invalid ones", async () => {
    const parse = vi.fn().mockResolvedValue({ id: "d1", status: "processing" });
    const onUploaded = vi.fn();
    render(<UploadDropzone client={{ parse }} onUploaded={onUploaded} />);
    const input = screen.getByTestId("file-input");
    const good = new File(["x"], "a.pdf", { type: "application/pdf" });
    const bad = new File(["x"], "notes.txt", { type: "text/plain" });
    await userEvent.setup({ applyAccept: false }).upload(input, [good, bad]);
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith({ id: "d1", status: "processing" }, good));
    expect(parse).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent("notes.txt: only PDF");
  });

  it("shows API errors such as quota exceeded", async () => {
    const parse = vi.fn().mockRejectedValue(new ApiError(402, "quota_exceeded", "Upgrade to keep parsing."));
    render(<UploadDropzone client={{ parse }} />);
    await userEvent.upload(screen.getByTestId("file-input"), new File(["x"], "a.pdf", { type: "application/pdf" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("a.pdf: Upgrade to keep parsing.");
  });

  it("does nothing when disabled", async () => {
    const parse = vi.fn();
    render(<UploadDropzone client={{ parse }} disabled />);
    expect(screen.getByRole("button", { name: /upload/i })).toHaveAttribute("aria-disabled", "true");
  });
});

describe("ResultViewer", () => {
  it("toggles between table and JSON views", async () => {
    render(<ResultViewer doc={doc} />);
    expect(screen.getByTestId("table-view")).toHaveTextContent("Northwind");
    expect(screen.getByText("$110.00")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "JSON" }));
    expect(screen.getByTestId("json-view")).toHaveTextContent('"invoice_number": "INV-9"');
    expect(screen.queryByTestId("table-view")).not.toBeInTheDocument();
  });

  it("downloads a CSV", async () => {
    const createObjectURL = vi.fn(() => "blob:x");
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<ResultViewer doc={doc} />);
    await userEvent.click(screen.getByRole("button", { name: /download csv/i }));
    expect(click).toHaveBeenCalled();
    const blob = (createObjectURL.mock.calls[0] as unknown as [Blob])[0];
    expect(blob.type).toContain("text/csv");
    const text = await new Promise<string>((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.readAsText(blob);
    });
    expect(text).toContain("INV-9");
  });

  it("shows per-field confidence and flags low fields", () => {
    render(
      <ResultViewer
        doc={{ ...doc, result: { ...result, field_confidence: { "vendor.name": 0.99, invoice_number: 0.62, total: 0.85 } } }}
      />,
    );
    expect(screen.getByLabelText("Vendor confidence 99%")).toBeInTheDocument();
    expect(screen.getByLabelText("Number confidence 62%")).toBeInTheDocument();
    expect(screen.getByLabelText("Total confidence 85%")).toBeInTheDocument();
    expect(screen.getByTestId("low-confidence")).toHaveTextContent("Number");
    expect(screen.getByTestId("low-confidence")).not.toHaveTextContent("Vendor");
  });

  it("shows server warnings and extra totals", () => {
    render(
      <ResultViewer
        doc={{
          ...doc,
          warnings: ["Line items add up to 90.00 but subtotal is 100.00."],
          result: { ...result, discount_total: 5, amount_due: 50, payment_terms: "Net 30" },
        }}
      />,
    );
    expect(screen.getByTestId("warnings")).toHaveTextContent("Line items add up to 90.00");
    expect(screen.getByText("-$5.00")).toBeInTheDocument();
    expect(screen.getByText("Amount due")).toBeInTheDocument();
    expect(screen.getByText("Net 30")).toBeInTheDocument();
  });

  it("hides the warnings box when there are none", () => {
    render(<ResultViewer doc={doc} />);
    expect(screen.queryByTestId("warnings")).not.toBeInTheDocument();
  });

  it("warns on low confidence", () => {
    render(<ResultViewer doc={doc} />);
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getByText(/double-check/i)).toBeInTheDocument();
  });
});

describe("UsageMeter", () => {
  const base = { plan: "pro" as const, period_start: "2026-11-01T00:00:00Z", period_end: "2026-12-01T00:00:00Z" };
  it("computes levels", () => {
    expect(usageLevel(10, 100)).toBe("ok");
    expect(usageLevel(80, 100)).toBe("warning");
    expect(usageLevel(100, 100)).toBe("exceeded");
    expect(usageLevel(0, 0)).toBe("exceeded");
  });
  it("renders progress and remaining", () => {
    render(<UsageMeter usage={{ ...base, docs_used: 450, docs_limit: 500 }} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "90");
    expect(screen.getByText(/only 50 documents left/i)).toBeInTheDocument();
  });
  it("clamps over-limit usage and explains overage on paid plans", () => {
    render(<UsageMeter usage={{ ...base, docs_used: 600, docs_limit: 500 }} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByText(/100 extra documents this month, billed at \$0.04 each/i)).toBeInTheDocument();
  });
  it("tells free users to upgrade at the cap", () => {
    const u = { ...base, plan: "free" as const, docs_used: 20, docs_limit: 20 };
    render(<UsageMeter usage={u} />);
    expect(screen.getByText(/hit this month's limit/i)).toBeInTheDocument();
    expect(isHardCapped(u)).toBe(true);
    expect(isHardCapped({ ...base, docs_used: 600, docs_limit: 500 })).toBe(false);
  });
});

describe("DocumentList", () => {
  it("shows an empty state", () => {
    render(<DocumentList documents={[]} />);
    expect(screen.getByText(/no documents yet/i)).toBeInTheDocument();
  });
  it("links rows to the result page", () => {
    render(<DocumentList documents={[doc, { ...doc, id: "doc_2", filename: "bad.png", status: "failed", result: null }]} />);
    expect(screen.getByRole("link", { name: /inv\.pdf/ })).toHaveAttribute("href", "/documents/doc_1");
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });
});

describe("StatusBadge", () => {
  it.each([
    ["completed", "Completed"],
    ["processing", "Processing"],
    ["queued", "Queued"],
    ["failed", "Failed"],
  ] as const)("%s", (s, label) => {
    render(<StatusBadge status={s} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

describe("ApiKeysManager", () => {
  const makeClient = () => {
    let keys = [{ id: "k1", name: "Prod", prefix: "dp_live_abcd", created_at: "2026-11-01T00:00:00Z", last_used_at: null }];
    return {
      listApiKeys: vi.fn(async () => keys),
      createApiKey: vi.fn(async (name: string) => ({
        id: "k2",
        name,
        prefix: "dp_live_ffff",
        created_at: "2026-11-02T00:00:00Z",
        last_used_at: null,
        secret: "dp_live_ffffSECRET",
      })),
      revokeApiKey: vi.fn(async (id: string) => {
        keys = keys.filter((k) => k.id !== id);
      }),
    };
  };

  it("lists, creates (showing the secret once) and revokes keys", async () => {
    const client = makeClient();
    render(<ApiKeysManager client={client} />);
    expect(await screen.findByText("Prod")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Key name"), "CI");
    await userEvent.click(screen.getByRole("button", { name: /create key/i }));
    expect(await screen.findByTestId("new-key")).toHaveTextContent("dp_live_ffffSECRET");
    expect(client.createApiKey).toHaveBeenCalledWith("CI");
    expect(screen.getByText("CI")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Revoke Prod" }));
    await waitFor(() => expect(screen.queryByText("Prod")).not.toBeInTheDocument());
  });

  it("validates the name", async () => {
    const client = makeClient();
    render(<ApiKeysManager client={client} />);
    await screen.findByText("Prod");
    await userEvent.click(screen.getByRole("button", { name: /create key/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/give the key a name/i);
    expect(client.createApiKey).not.toHaveBeenCalled();
  });

  it("hides key creation and shows an upgrade link without API access", async () => {
    render(<ApiKeysManager client={makeClient()} apiAccess={false} />);
    await screen.findByText("Prod");
    expect(screen.getByTestId("upgrade-notice")).toHaveTextContent(/pro and business/i);
    expect(screen.getByRole("link", { name: "See plans" })).toHaveAttribute("href", "/billing");
    expect(screen.queryByRole("button", { name: /create key/i })).not.toBeInTheDocument();
  });

  it("shows load errors", async () => {
    render(
      <ApiKeysManager
        client={{ listApiKeys: vi.fn().mockRejectedValue(new Error("Boom")), createApiKey: vi.fn(), revokeApiKey: vi.fn() }}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Boom");
  });
});

describe("BillingPlans", () => {
  it("marks the current plan and upgrades", async () => {
    const onSelect = vi.fn().mockResolvedValue(undefined);
    render(<BillingPlans plans={PLANS} currentPlan="pro" onSelect={onSelect} />);
    expect(screen.getByRole("button", { name: "Current plan" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Upgrade to Business" }));
    expect(onSelect).toHaveBeenCalledWith("business");
    const free = document.querySelector('[data-plan="free"]') as HTMLElement;
    expect(within(free).getByRole("button", { name: "Switch to Free" })).toBeEnabled();
  });
});
