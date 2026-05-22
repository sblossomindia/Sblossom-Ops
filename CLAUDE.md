# CLAUDE.md — Sblossom Operations & Tracking System

Read this at the start of every session. This is the durable context for the project.

## Project summary
Next.js app on Cloudflare Pages with two surfaces sharing one Postgres database:
- `admin.sblossom.com` — internal ops app for 5 employees (Production / QC / Shipment / Admin)
- `track.sblossom.com` — public customer tracking + callback request

**Shopify is the system of record for orders.** This app is a *transient operational cache* — it holds production workflow state for in-flight orders only. Completed orders are deleted 30 days after delivery, by design.

The full specification is in `SPEC.md`. The DB schema is in `schema.sql`. Templates are in `interakt_templates.md`. The task backlog is in `tasks.md`. **Read SPEC.md before starting any non-trivial task.**

## Stack
- Next.js 15 (App Router), TypeScript strict mode, React Server Components by default
- Tailwind + shadcn/ui
- Cloudflare Pages hosting via `@cloudflare/next-on-pages` adapter
- Postgres on Supabase Free tier (use Drizzle ORM)
- Cloudflare R2 (`@aws-sdk/client-s3`, `@aws-sdk/lib-storage` for multipart) for mockup PSDs + QC photos
- NextAuth Credentials provider, bcrypt (cost 12) for employee passwords
- jose for customer JWT sessions
- Cloudflare Cron Triggers for scheduled jobs (NOT Vercel Cron)
- Integrations: Shopify Admin API + webhooks, Interakt WhatsApp API, Shipmozo
- Testing: Vitest (unit) + Playwright (e2e on critical flows)

## Repository layout
```
/app
  /(admin)                  — admin.sblossom.com (auth-required)
    /orders/new             — Tab 1
    /orders/in-production   — Tab 2
    /orders/qc              — Tab 3 (mobile-first)
    /orders/shipment        — Tab 4
    /orders/tracking        — Tab 5
    /call-requests          — Tab 6
    /admin/users            — admin only
    /admin/tags             — admin only
    /admin/notifications    — admin only
  /(customer)               — track.sblossom.com
    /                       — login (order# + phone)
    /verify                 — OTP entry
    /track                  — tracking page
  /api
    /webhooks/shopify/*
    /webhooks/interakt
    /cron/*
/components
/lib
  /db                       — Drizzle config + queries
  /shopify
  /interakt                 — client (rate-limited), template builders, webhook handler
  /shipmozo
  /storage                  — R2 helpers, presigned URL generation
  /auth                     — NextAuth + customer JWT
  /state-machine            — order + item state transitions
  /tags                     — tag sync to/from Shopify
/drizzle                    — migrations
/scripts                    — create-user.ts, reset-password.ts, seed.ts, etc.
SPEC.md
schema.sql
interakt_templates.md
shopify_webhooks_test.md
tasks.md
cost_estimate.md
CLAUDE.md
```

## Hard rules (do not violate)

1. **State transitions only via `lib/state-machine`.** Never run raw `UPDATE orders SET state = ...` outside this module. Every transition writes to `order_status_history` in the same transaction.

2. **The DB is a transient ops cache.** Do NOT suggest adding PITR backups, longer retention, or "just in case" archive features. The 30-day TTL is intentional. If a feature seems to require persistent data beyond 30 days, raise it with the user instead of silently adding it.

3. **Interakt rate limit: 35 req/min.** Interakt's hard cap is 40; we leave 5/min headroom. The `lib/interakt/client.ts` MUST implement a token-bucket or queue. Do not call the API in a loop without rate limiting.

4. **R2 uploads use presigned URLs + multipart.** Files up to 1000 MB are valid. Use `@aws-sdk/lib-storage`'s `Upload` for multipart. NEVER proxy file bytes through the app server (Cloudflare Workers has a 100 MB request body limit and proxying wastes bandwidth).

5. **No notification sends inside DB transactions.** Write the `notifications_log` row first (status `queued` or `scheduled`), commit, then dispatch the actual Interakt call. Update the row status based on result.

6. **All Shopify webhook handlers verify HMAC.** Reject 401 if invalid. Use `req.text()` to get the raw body BEFORE parsing — `req.json()` re-orders keys and breaks HMAC verification.

7. **Idempotency on Shopify webhooks via `X-Shopify-Webhook-Id`.** Insert into `shopify_webhook_events` with `webhook_id` as a unique key. Duplicate = return 200 immediately, don't reprocess.

8. **Phone numbers in E.164** (`+91XXXXXXXXXX`). One helper in `lib/phone.ts` for normalization. Never store local-format phones.

9. **OTP codes hashed at rest** (bcrypt). Never log plaintext. Rate limits enforced server-side.

10. **Server Components by default.** Use `"use client"` only when interactivity demands it.

11. **Type the boundaries.** Zod schemas for all API request/response bodies, webhook payloads, and form inputs. Infer TS types from Zod.

12. **Environment validation at startup** in `lib/env.ts` via Zod. Throw on missing required vars.

13. **Individual user accounts only.** No shared logins. The audit trail depends on this.

14. **QC is per-item, state transitions are per-order.** The order moves to `qc_passed` only when ALL items have passed. A failed item goes back to production independently while passed items wait.

15. **1-hour QC grace window.** When the final item in an order passes QC, do NOT send the `qc_passed` WhatsApp immediately. Insert a `notifications_log` row with status `scheduled` and `scheduled_for = now() + 1h`. A cron job processes scheduled sends every minute. Any QC flip during the grace window resets the timer (delete the scheduled row, insert a new one).

16. **`qc_failed_remaking` notification fires only ONCE per order** even if multiple items fail across multiple QC rounds. Check `notifications_log` for prior sends before queueing a new one.

17. **Tags sync bidirectionally with Shopify.** When tags change on either side, mirror to the other. Use `updated_at` for last-write-wins to avoid sync loops. Customer-visibility flag (`is_customer_visible`) is local-only — Shopify doesn't have this concept.

## Brand & content rules

- **Never use "engraving" or "engraved"** for Sblossom products. They're personalized wooden products.
- Use "hanging heart" instead of "heart pendant".
- Don't claim UV coating, waterproofing, or any unverified treatment.
- Currency: ₹ before number, no space: `₹1,299`. In WhatsApp templates use `Rs.` for safety (Unicode rupee sometimes mangled in Meta's review).
- Indian honorifics (MBBS, BAMS, BDS, etc.) are valid in customer-provided names.
- Brand colors: maroon + pink. Fonts: Fraunces (display), DM Sans (body). Use CSS variables from shadcn/ui — don't hardcode hex.

## Integration specifics

### Shopify
- Tag trigger: exactly `under production` (case-sensitive, single space).
- Required scopes: `read_orders`, `write_orders` (for tag sync), `read_fulfillments`, `read_customers`.
- Tag sync mirrors changes both ways. Use the `updatedAt` timestamp on both sides as the conflict resolver.
- Ingest only orders with the trigger tag. Upsert on `shopify_order_id` for idempotency.

### Interakt (already provisioned — just env vars needed)
- Single client in `lib/interakt/client.ts` with built-in rate limiter (35 req/min).
- Every send: write `notifications_log` row first (status `queued`), attempt send, update status.
- Retry up to 3× with exponential backoff on 5xx or network errors. Don't retry 4xx.
- Templates listed in `interakt_templates.md` and constants in `lib/interakt/templates.ts`.
- Inbound webhook at `/api/webhooks/interakt`: handles delivery receipts (updates `notifications_log.status`) and customer replies (creates `call_requests` row with reply text as `notes`).

### Shipmozo
- Fallback only. Don't call from request path of customer page loads — read cached values from `orders`.
- Cron at `/api/cron/shipmozo-poll` runs every 30 min.

### Cloudflare R2
- Two buckets: `sblossom-mockups` (PSDs + thumbnails) and `sblossom-qc-photos`.
- Presigned URL flow: client requests upload URL from server → uploads directly to R2 → confirms completion to server with the key → server saves URL.
- View URLs are presigned with 1 h expiry. Generate fresh on every render.

## Conventions

### Code style
- Prettier defaults, 100 char line limit.
- No `any`. Use `unknown` + narrowing.
- Named exports preferred; default exports only where Next.js requires them.
- Early returns over nested conditionals.

### DB
- Drizzle queries in `lib/db/queries/<entity>.ts`.
- Complex SQL in `lib/db/sql/<name>.sql` and loaded.
- The `customer_order_view` is the single source of truth for the customer app. Don't write competing queries that compute display status differently.

### Errors
- Throw typed errors (`class AppError extends Error` with `code` and `httpStatus`).
- API routes return `{ error: { code, message } }` on failure.
- Never leak stack traces to clients.

### Tests
- Required: state machine transitions, webhook HMAC, OTP flow, phone normalization, Interakt rate limiter, QC grace window timer.
- Skip: trivial UI components, third-party SDK behaviour.

## When to stop and ask the user

Ask before:
- Adding a new dependency not already in `package.json`.
- Changing the state machine or adding a state.
- Modifying `SPEC.md`, `schema.sql`, or `interakt_templates.md` — these are user-owned. Propose, don't apply.
- Hitting Interakt or Shipmozo in dev/test mode (real money + real customers). Use mock mode via `MOCK_INTERAKT=1` and `MOCK_SHIPMOZO=1`.
- Deploying to production.
- Suggesting backups, archival, or longer retention. The transient-cache design is intentional.

## Common commands

```bash
pnpm dev                              # Next.js dev server
pnpm db:push                          # Push Drizzle schema to Supabase
pnpm db:migrate                       # Run migrations
pnpm db:studio                        # Drizzle Studio
pnpm test                             # Vitest
pnpm test:e2e                         # Playwright
pnpm lint
pnpm typecheck

# User management
pnpm tsx scripts/create-user.ts       # Prompts for email, name, role, password
pnpm tsx scripts/reset-password.ts <email>
pnpm tsx scripts/disable-user.ts <email>

# Useful
pnpm seed                             # Dev seed data
pnpm tsx scripts/<name>.ts            # One-off scripts
```

## Session startup checklist
1. Read `SPEC.md` if working on a new area.
2. Read `tasks.md` and pick a task.
3. Check `git status` and current branch.
4. If unclear, ask one focused question.
