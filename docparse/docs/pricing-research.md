# DocParse: market research and pricing (Thread 1)

Checked 2026-11-12 from public pricing pages and 2026 comparison articles.

## Competitors

| Product | Entry plan | Included | Per doc | API on entry plan |
|---|---|---|---|---|
| Docparser | $39/mo Starter | 100 docs (up to 5 pages each) | $0.39 | Yes |
| Docparser | $74 Professional / $159 Business | 250 / 1,000 docs | $0.30 / $0.16 | Yes |
| Airparser | $49 Growth / $149 Business | 500 / 2,000 pages | $0.098 / $0.075 | Yes |
| Parseur | $99 to $129/mo Starter | 1,000 pages | ~$0.10 to $0.13 | Yes |
| ImageToTable | $9 / $19 / $59 | 150 / 400 / 1,500 credits | ~$0.04 to $0.06 | Unclear |
| Mindee | ~$44/mo (annual) | credit packs | from $0.05/page | Yes |
| Veryfi | Free 100 docs/mo; Starter $500/mo minimum | usage | $0.08 receipt, $0.16 invoice | Yes |
| Nanonets | PAYG $0.30/page; Pro $499 | usage | high | Yes |
| Rossum | $1,500/mo, annual | volume tiers | enterprise | Yes |

## Takeaways

1. Self-serve tools cluster at $39 to $49 to start, at $0.10 to $0.39 per document. Developer-grade APIs (Veryfi, Rossum, Nanonets) start at $500+/month.
2. The gap: a cheap, self-serve plan that includes the API. Nobody under $20 offers API plus line items.
3. Buyers hate credit math (credits per page, per "block"). One rule wins: 1 document = 1 file up to 5 pages.

## Pricing decision (draft kept, with adjustments)

| Plan | Monthly | Annual | Docs/mo | Overage | API |
|---|---|---|---|---|---|
| Free | $0 | $0 | 20 | hard cap | No (web app only) |
| Pro | $19 | $190 | 500 | $0.04/doc | Yes, 60 req/min |
| Business | $49 | $490 | 2,500 | $0.025/doc | Yes, 300 req/min, webhooks, custom fields, 5 seats |

Changes from the draft:
- API moved down to Pro. It is the main wedge against Docparser ($39 for 100 docs).
- Added overage so heavy users pay more instead of hitting a wall. Pro to Business break-even is 1,250 docs.
- Annual billing at 2 months free (17% off).
- Defined a document as one file of up to 5 pages; longer files count ceil(pages/5).

## Unit economics (for Thread 2)

Claude API list prices (Nov 2026, per million tokens in/out): Haiku 5.5 $0.10/$0.50, Sonnet 5.5 $2/$10, Opus 5.5 $4/$20.
A 1 to 2 page invoice is roughly 3k input and 1k output tokens:
- Haiku 5.5: ~$0.001 per doc
- Sonnet 5.5: ~$0.016 per doc
- Opus 5.5: ~$0.03 per doc

Business includes docs at $0.0196 each, so extraction must not default to Opus. Suggested: Haiku 5.5 first, retry on Sonnet 5.5 when confidence is low. This keeps gross margin above 80% on every plan.

## Contracts for other threads

- `lib/pricing.ts` is the source of truth for plans. Stripe lookup keys: `pro_monthly`, `pro_annual`, `business_monthly`, `business_annual`.
- Sign-up links go to `/signup?plan=<id>&cycle=<monthly|annual>` (Thread 3).
- Marketing pages link to `/login`, `/signup`, `/docs/api`, `/privacy`, `/terms`, which do not exist yet.
- Copy promises the backend must honor: files encrypted and never used for training, user can delete files, failed extractions not counted, 20 MB max, PDF/PNG/JPG/WEBP, per-field confidence scores.
- `components/ui/button.tsx` is a minimal shadcn-style button; Thread 4 can replace it.
