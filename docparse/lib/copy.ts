export const HERO = {
  eyebrow: "Invoice and receipt parsing API",
  title: "Invoices in. Clean JSON out.",
  subtitle:
    "DocParse reads invoices and receipts, PDF or photo, and returns structured JSON or CSV in seconds. Vendor, dates, totals, tax and every line item. No templates to set up, no rules to maintain.",
  primaryCta: "Start free",
  secondaryCta: "See the API",
  reassurance: "20 free documents every month. No credit card.",
};

export const FEATURES = [
  {
    icon: "Sparkles",
    title: "No templates",
    body: "Works on layouts it has never seen. A new supplier format does not mean a new parsing rule.",
  },
  {
    icon: "ListTree",
    title: "Line items, not just totals",
    body: "Every row comes back with description, quantity, unit price and amount, ready for your books.",
  },
  {
    icon: "Code2",
    title: "One API call",
    body: "POST a file, get JSON back. Typed schema, predictable fields, clear error codes.",
  },
  {
    icon: "FileSpreadsheet",
    title: "JSON or CSV",
    body: "Download CSV for a spreadsheet, or pipe JSON straight into your accounting or ERP system.",
  },
  {
    icon: "Gauge",
    title: "Confidence scores",
    body: "Each field carries a confidence score, so you review only the values that need a second look.",
  },
  {
    icon: "ShieldCheck",
    title: "Private by default",
    body: "Files are encrypted in transit and at rest, never used for training, and you can delete them any time.",
  },
] as const;

export const STEPS = [
  {
    title: "Upload",
    body: "Drop PDFs, scans or phone photos into the web app, or send them to the API.",
  },
  {
    title: "Extract",
    body: "DocParse finds the vendor, dates, totals, tax and line items in a few seconds.",
  },
  {
    title: "Export",
    body: "Download JSON or CSV, or receive the result by webhook in your own system.",
  },
] as const;

export const USE_CASES = [
  { title: "Bookkeepers", body: "Stop retyping supplier invoices into the ledger every month end." },
  { title: "Developers", body: "Add invoice parsing to your product without training a model." },
  { title: "Ops and finance teams", body: "Turn a folder of receipts into one clean expense CSV." },
] as const;

export const FAQ = [
  {
    q: "What counts as a document?",
    a: "One uploaded file of up to 5 pages. A 12-page PDF counts as 3 documents. Failed extractions are not counted.",
  },
  {
    q: "Which file types do you support?",
    a: "PDF, PNG, JPG and WEBP, including scans and phone photos. Files can be up to 20 MB.",
  },
  {
    q: "What fields do you extract?",
    a: "Vendor name and address, invoice number, issue and due dates, currency, subtotal, tax, total, and every line item. On Business you can add your own custom fields.",
  },
  {
    q: "Is the API included on Pro?",
    a: "Yes. Pro and Business both include the REST API. Business adds webhooks, higher rate limits and custom fields.",
  },
  {
    q: "What happens if I go over my monthly documents?",
    a: "On Pro and Business, extra documents are billed at a low per-document rate at the end of the month. On Free, uploads pause until the next month.",
  },
  {
    q: "Do you train on my documents?",
    a: "No. Your files are only used to produce your results, and you can delete them at any time.",
  },
  {
    q: "Can I cancel any time?",
    a: "Yes. Plans are month to month unless you choose annual billing, and you can cancel from your account settings.",
  },
] as const;

/** Sample extraction shown in the hero. Mock data. */
export const SAMPLE_OUTPUT = {
  vendor: { name: "Northwind Supplies Ltd", tax_id: "GB 123 4567 89" },
  invoice_number: "INV-20418",
  issue_date: "2026-10-03",
  due_date: "2026-11-02",
  currency: "USD",
  line_items: [
    { description: "Thermal labels 4x6 (roll)", quantity: 12, unit_price: 8.5, amount: 102.0 },
    { description: "Packing tape 48mm", quantity: 24, unit_price: 2.25, amount: 54.0 },
  ],
  subtotal: 156.0,
  tax: 31.2,
  total: 187.2,
  confidence: 0.98,
} as const;
