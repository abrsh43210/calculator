# Extraction engine and API routes (Thread 2)

Response shapes follow `lib/api/types.ts` (the dashboard contract). Server code lives in `lib/extract` (Claude extraction) and `lib/server` (auth, usage, storage interfaces, handlers). Routes in `app/api/v1`.

## Endpoints

All accept either the dashboard's signed-in session (cookie) or an API key (`Authorization: Bearer dp_live_...` or `x-api-key`). API keys only work on Pro and Business; Free users can still upload through the web app.

| Route | Returns |
|---|---|
| `POST /api/v1/parse` | `201 ParseResponse` `{ id, status: "completed", document: DocumentRecord }`, `Location` header. `?format=csv` returns CSV instead. |
| `GET /api/v1/documents/:id` | `DocumentRecord` (`?format=csv` for CSV). Another user's id is a 404. |
| `GET /api/v1/documents?cursor&limit` | `DocumentListResponse`, newest first, limit 1 to 100 (default 20). |
| `GET /api/v1/usage` | `Usage` for the current period. |

Upload, one of:
- `multipart/form-data` with field `file`, or the raw file as the body (optional `x-file-name`). On Vercel this only works up to 4.5 MB.
- For anything larger (up to 20 MB): get a signed URL from `POST /api/v1/uploads` (Thread 3), `PUT` the file there, then call parse with JSON `{ "storage_path": "...", "filename": "optional display name" }`. The stored file is deleted after extraction, except after a retryable 503 so the same path can be retried. Another user's path is a 404 (`upload_not_found`).

PDF, PNG, JPG, WEBP up to 20 MB.

```bash
curl -X POST https://<host>/api/v1/parse -H "Authorization: Bearer $DOCPARSE_KEY" -F file=@invoice.pdf
```

`DocumentRecord` gains optional server fields (added to `lib/api/types.ts`): `page_count`, `billable_units` (= ceil(pages / 5)), `warnings` (e.g. totals that do not add up), `model`. `ExtractionResult` gains optional `discount_total`, `shipping_total`, `amount_paid`, `amount_due`, `payment_method`, `payment_terms`, `notes`; line items gain `tax_rate`, `sku`; parties gain `email`, `phone`. `field_confidence` uses the `ConfidenceField` keys (`"vendor.name"`, `"total"`, ...).

CSV uses `resultToCsv` from `lib/csv.ts`, so the API and the dashboard download match.

### Errors
`{ "error": { "type", "code", "message", "request_id" } }` (a superset of the dashboard's `{ error: { code, message } }`), plus an `x-request-id` header.

| Status | code |
|---|---|
| 400 | invalid_format, invalid_limit, missing_file, invalid_multipart, empty_file |
| 401 | unauthenticated, invalid_api_key |
| 403 | plan_without_api_access |
| 404 | document_not_found |
| 413 | file_too_large |
| 415 | unsupported_file_type |
| 422 | unsupported_document (not an invoice/receipt), refused, output_truncated |
| 429 | quota_exceeded (Free plan only; paid plans go into overage) |
| 502 / 503 | upstream_* , invalid_model_output (503 carries `retry-after`) |

Parse responses carry `x-quota-included`, `x-quota-used`, `x-quota-remaining`, `x-quota-reset`. Failed extractions are never billed.

## How extraction works (`lib/extract`)
1. Detect the real type from magic bytes; 20 MB max.
2. Count pages; billable units = ceil(pages / 5). Quota is reserved before calling Claude and released on any failure.
3. Images over Claude's 5 MB limit are downscaled with `sharp` (EXIF-rotated, JPEG).
4. Claude Haiku 5.5 extracts with structured outputs (zod schema in `lib/extract/schema.ts`). If it is unsure (confidence < 0.8, totals do not add up, refusal, malformed output, "not an invoice", or an API error), Claude Sonnet 5.5 re-runs it with server-side refusal fallbacks, and the better answer wins.
5. Arithmetic and date checks produce `warnings` instead of failing.

Env: `ANTHROPIC_API_KEY` (required), `DOCPARSE_PRIMARY_MODEL`, `DOCPARSE_ESCALATION_MODEL` (`none` disables the retry), `DOCPARSE_ESCALATE_BELOW`, `DOCPARSE_EFFORT`, `DOCPARSE_ALLOW_MOCKS`.

## Contracts for Thread 3 (auth, DB, Stripe)
Implement these and register them with `setServices()` from `lib/server/services.ts` (e.g. in `instrumentation.ts`). Until then in-memory mocks are used: every browser request is signed in as a dev Business user, and the dev API key is `dp_test_devkey000000000000000000000000`. Production refuses to run on mocks unless `DOCPARSE_ALLOW_MOCKS=1`.

- `ApiKeyVerifier.verify(rawKey)` (`lib/server/auth.ts`): look up `hashApiKey(rawKey)` (SHA-256 hex; never store raw keys), reject revoked keys, return `{ userId, plan, apiKeyId, livemode }`. Keys match `dp_(live|test)_[A-Za-z0-9]{24,64}`.
- `SessionResolver.resolve(req)` (`lib/server/auth.ts`): Supabase SSR session from cookies, return `{ userId, plan, livemode }` or null.
- `UsageService.reserve(principal, units)` / `summary(principal)` (`lib/server/usage.ts`): reserve must be atomic (one Postgres `UPDATE ... RETURNING`). Free is hard-capped; Pro and Business allow overage. `commit()` records the usage row and the Stripe meter event for overage; `release()` undoes the reservation.
- `DocumentStore.save/get/list` (`lib/server/documents.ts`): always filter by user id.

## Open items
- Done: the dashboard sends files over 4 MB through the signed-upload flow (lib/api/http.ts) and allows up to 20 MB.
- Per-key rate limits (Pro 60/min, Business 300/min) are not enforced yet; best added next to `UsageService` (Upstash Redis or a Postgres counter).
- Extraction quality is untested on real invoices (no Anthropic key was available here). Run 20 to 30 real documents before launch and tune `DOCPARSE_ESCALATE_BELOW`.
