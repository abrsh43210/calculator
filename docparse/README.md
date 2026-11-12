# DocParse

Invoices and receipts (PDF or image) to JSON or CSV. Next.js 15 App Router, TypeScript, Tailwind v4.

```
npm install
npm run dev        # http://localhost:3000 and /pricing
npm test           # vitest
npm run build
```

Marketing pages live in `app/(marketing)`. Plans and prices: `lib/pricing.ts`. Copy: `lib/copy.ts`.
Research and pricing rationale: `docs/pricing-research.md`.

## App dashboard (Thread 4)

Signed-in app lives in `app/(app)`: `/dashboard` (upload + usage + recent docs), `/documents`, `/documents/[id]` (table/JSON view, per-field confidence, CSV and JSON download), `/api-keys`, `/billing`.

- Theme: `next-themes`, dark by default, toggle in the app header (`components/theme-toggle.tsx`). Tokens in `app/globals.css`.
- UI kit: `components/ui/*` (shadcn-style button, card, badge, input, progress, table).
- API contract: `lib/api/types.ts` (shapes of `POST /api/v1/parse`, `GET /api/v1/documents/:id`, usage, keys, subscription). Thread 2 and 3 should return these shapes.
- Client: `lib/api/client.ts` picks `lib/api/mock.ts` (in-browser mock) or `lib/api/http.ts` (real fetch). Set `NEXT_PUBLIC_USE_MOCKS=false` once the routes exist. See `.env.example`.
- Endpoints the HTTP client calls: `POST /api/v1/parse` (multipart `file`), `GET /api/v1/documents[?cursor&limit]`, `GET /api/v1/documents/:id`, `GET /api/v1/usage`, `GET /api/billing/subscription`, `POST /api/billing/checkout {plan}` → `{url}`, `POST /api/billing/portal` → `{url}`, `GET/POST /api/keys`, `DELETE /api/keys/:id`. Errors: `{ error: { code, message } }`.

## Auth, database and billing (Thread 3)

Supabase (Postgres, Auth, Storage) and Stripe. Plans, prices and limits come from `lib/pricing.ts`; Stripe prices are looked up by lookup key, so there are no price ids in env.

### Setup

1. **Env.** `cp .env.example .env.local` and fill in the Supabase and Stripe keys.
2. **Database.** Apply `supabase/migrations/` with `supabase db push` (or paste the SQL into the Supabase SQL editor). It creates `profiles`, `subscriptions`, `api_keys`, `documents`, `usage_events`, `stripe_events`, RLS on every table, the quota functions and a private `documents` storage bucket.
3. **Auth.** In Supabase, go to Authentication > URL Configuration. Set Site URL to `NEXT_PUBLIC_SITE_URL` and add `<site>/auth/callback` to Redirect URLs. For Google, create an OAuth client in Google Cloud with redirect URI `https://<project>.supabase.co/auth/v1/callback`, then paste its id and secret under Authentication > Providers > Google.
4. **Stripe products.** `STRIPE_SECRET_KEY=sk_test_... npm run stripe:setup` creates the overage meter, both products and the six prices (`pro_monthly`, `pro_annual`, `business_monthly`, `business_annual`, `pro_overage`, `business_overage`). It's safe to re-run.
5. **Webhook.** Locally, run `stripe listen --forward-to localhost:3000/api/webhooks/stripe` and put the `whsec_` it prints into `.env.local`. In production, add an endpoint for `https://<site>/api/webhooks/stripe` with these events: `checkout.session.completed`, `customer.subscription.created`, `.updated`, `.deleted`, `.paused`, `.resumed`, `invoice.paid` and `invoice.payment_failed`.
6. **Customer Portal.** In Stripe, go to Settings > Billing > Customer portal and turn on payment methods, invoices and cancellation. Leave plan switching off: the app does plan switches itself.
7. **Cron.** `vercel.json` runs `/api/cron/report-usage` hourly. Set `CRON_SECRET` in Vercel.

### How billing works

- **Signup to checkout.** Pricing buttons link to `/signup?plan=pro&cycle=annual`. After signup or Google sign-in, the user lands on `/checkout?plan=…&cycle=…`, which redirects to Stripe Checkout. Signed-in users skip straight to checkout.
- **Subscriptions** have two items: the base plan price (monthly or annual) and a metered overage price. They use `billing_mode: flexible` so an annual base can sit beside the monthly overage.
- **Webhook** (`/api/webhooks/stripe`) verifies the signature, skips events it has already seen (`stripe_events`), re-fetches the subscription from Stripe so events that arrive out of order can't roll state back, upserts `subscriptions` and sets `profiles.plan` to the best entitled plan. `past_due` keeps access during dunning. It answers 500 on transient errors so Stripe retries.
- **Plan changes.** If a subscriber picks another plan, the subscription is switched in place with proration. Picking their current plan opens the portal.
- **Quota.** Included docs reset monthly. Annual plans also reset every month, on the signup day. Free stops at 20. Pro and Business keep working past their limit, and the extra docs are overage.

### Services for the extraction API (Thread 2)

`lib/server/supabase-services.ts` implements Thread 2's interfaces. `getServices()` uses them automatically when `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set, and falls back to the in-memory mocks otherwise.

- `SupabaseApiKeyVerifier` looks keys up by `hashApiKey()` (SHA-256) through `verify_api_key`, which skips revoked keys and stamps `last_used_at`. Keys look like `dp_live_` (Stripe live mode) or `dp_test_`, followed by 32 alphanumerics.
- `SupabaseSessionResolver` uses the Supabase SSR cookie session and reads the plan from `profiles`.
- `SupabaseUsageService.reserve()` calls `consume_quota`, which takes a per-user advisory lock and inserts the usage row in one transaction. Free is hard-capped; Pro and Business go into overage. `commit()` links the document and sends overage to the Stripe meter, with `usage_<id>` as an idempotent identifier. `release()` deletes the reservation, so failed extractions are free.
- `SupabaseDocumentStore` filters every query by `user_id` and paginates with a keyset on `(created_at, id)`.
- `SupabaseUploadStore` handles files over Vercel's 4.5 MB body limit (up to 20 MB). See `lib/server/uploads.ts`: `POST /api/v1/uploads`, then `PUT` the file to `upload_url`, then `POST /api/v1/parse {"storage_path": ...}`. Thread 2 owns that last step.

### Routes

| Route | Auth | Returns |
| --- | --- | --- |
| `GET /api/billing/subscription` | session | `Subscription` |
| `POST /api/billing/checkout` `{plan, cycle?}` | session | `{ url, kind: "checkout" \| "updated" \| "portal" }` |
| `POST /api/billing/portal` | session | `{ url }` (409 `no_billing_account` if they never paid) |
| `GET /checkout?plan=&cycle=` | session, or redirects to signup | 303 to Stripe |
| `GET /api/keys` | session | `ApiKey[]` |
| `POST /api/keys` `{name}` | session, Pro/Business | `CreatedApiKey` (secret shown once) |
| `DELETE /api/keys/:id` | session | 204 |
| `POST /api/v1/uploads` `{filename, size_bytes, mime_type}` | session or API key | `SignedUpload` (for files over 4 MB) |
| `POST /api/webhooks/stripe` | Stripe signature | |
| `GET /api/cron/report-usage` | `CRON_SECRET` | `{ reported }` |
| `/login`, `/signup`, `/auth/callback`, `/auth/confirm` | | email + Google auth |

### Tests

- `npm test` runs the Vitest suites in `tests/billing/` (Stripe and Supabase mocked; webhook signatures are verified for real).
- `npm run test:sql` applies the migrations to a scratch Postgres (it needs `psql` and a superuser via `PGHOST`, `PGUSER` and `PGPASSWORD`) and checks RLS, column privileges, quota, overage, refunds and API-key lookup.
