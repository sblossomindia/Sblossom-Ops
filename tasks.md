# Tasks — Sblossom Ops & Tracking (v2)

Tickets are sized for one Claude Code session each. Work top-to-bottom within a phase. Don't start Phase 2 until Phase 1 is deployed and used in production.

Status: ☐ todo · ◐ in progress · ☑ done

---

## Phase 0 — Setup (manual, you)

☐ **0.1** Create Cloudflare account (Pages + R2 + Cron) if not done. Note account ID.
☐ **0.2** Create Supabase project (Free tier). Save connection strings.
☐ **0.3** Create two R2 buckets: `sblossom-mockups`, `sblossom-qc-photos`. Generate API token with R2 read/write.
☐ **0.4** Submit the 7 Interakt templates from `interakt_templates.md` for Meta approval. Critical path — start today.
☐ **0.5** Get Shopify custom app credentials. Scopes: `read_orders`, `write_orders`, `read_fulfillments`, `read_customers`. Note admin access token + webhook secret.
☐ **0.6** Confirm Shipmozo API key + secret.
☐ **0.7** Point DNS for `admin.sblossom.com` and `track.sblossom.com` at Cloudflare Pages.
☐ **0.8** Create GitHub repo `sblossom-ops`. Commit `SPEC.md`, `schema.sql`, `CLAUDE.md`, `tasks.md`, `interakt_templates.md`, `shopify_webhooks_test.md`, `cost_estimate.md`.

---

## Phase 1 — Foundation & Internal MVP

**Goal:** Production team uses Tabs 1 + 2 daily on real orders.

☐ **1.1 — Project scaffold**
Initialize Next.js 15 (App Router, TS, Tailwind). Install: `drizzle-orm`, `drizzle-kit`, `postgres`, `zod`, `next-auth`, `bcryptjs`, `jose`, `@aws-sdk/client-s3`, `@aws-sdk/lib-storage`, `@aws-sdk/s3-request-presigner`, `@cloudflare/next-on-pages`, shadcn/ui baseline. Configure ESLint + Prettier. `lib/env.ts` with Zod-validated env vars. Wrangler config for Cloudflare Pages.

☐ **1.2 — Database schema & migrations**
Convert `schema.sql` to Drizzle migrations. Run against Supabase Free. Verify all enums, tables, indexes, `customer_order_view`, and cleanup functions exist. Add `pnpm db:seed` creating one admin user + 3 fake orders (each with 1-3 items) for local testing.

☐ **1.3 — User management scripts**
`scripts/create-user.ts`: interactive prompt for email/name/role/password. Hashes with bcrypt cost 12. Inserts to `users`.
`scripts/reset-password.ts <email>`: prompts for new password, updates `password_hash`.
`scripts/disable-user.ts <email>`: sets `is_active = false`.

☐ **1.4 — Employee auth**
NextAuth Credentials provider. Login page at `/login`. 5-failed-attempts → 15 min lockout (tracked in `users.failed_login_attempts` + `lockout_until`). 8 h JWT idle expiry. Middleware gates `/(admin)/*` routes by role.

☐ **1.5 — Cloudflare Pages deployment scaffold**
Connect GitHub repo to Cloudflare Pages. Configure build (`@cloudflare/next-on-pages`). Verify hello-world deploys. Configure both custom subdomains.

☐ **1.6 — Shopify client + webhook receiver**
`lib/shopify/client.ts` (GraphQL preferred). Handlers at `/api/webhooks/shopify/orders` and `/api/webhooks/shopify/fulfillments`. HMAC verification with `req.text()` first. Idempotency via `X-Shopify-Webhook-Id` unique constraint. On `orders/create` or `orders/updated` with tag `under production`: upsert into `orders` + insert all `order_items` from `line_items`. Status `approval_pending`. Unit tests for HMAC.

☐ **1.7 — R2 storage helpers + presigned URLs**
`lib/storage/r2.ts`. Functions: `getMockupSourceUploadUrl(orderItemId, filename)` → presigned PUT, size limit 1000 MB. `getMockupThumbUploadUrl(orderItemId, filename)` → presigned PUT, size limit 5 MB. `getQcPhotoUploadUrl(orderItemId)` → presigned PUT, size limit 10 MB. `getViewUrl(key)` → 1 h GET. Multipart upload helper using `@aws-sdk/lib-storage`. Server route that signs URLs after validating the caller is auth'd + the item belongs to them.

☐ **1.8 — Interakt client with rate limiter**
`lib/interakt/client.ts` with token-bucket rate limiter (35 req/min). `lib/interakt/templates.ts` typed builders for each of the 7 templates. Every send writes `notifications_log` row first. `MOCK_INTERAKT=1` env short-circuits to console. Retry 3× on 5xx with exponential backoff. Tests for the rate limiter under burst load.

☐ **1.9 — State machine**
`lib/state-machine/index.ts`. `transitionOrder(orderId, toState, actor, opts)` inside a DB transaction: validate legal transition, update order, append `order_status_history`. Helpers: `tryAdvanceFromItemQc(orderId)` — checks if all items have a QC status, decides whether to start grace period. `scheduleQcPassedNotification(orderId)` — inserts scheduled `notifications_log` row. `resetGraceTimer(orderId)` — used when QC flips. Unit tests for all legal + illegal transitions.

☐ **1.10 — Tab 1: Order Create (multi-item)**
Route: `/(admin)/orders/new`. Lists orders where `state = 'approval_pending' AND deleted_at IS NULL`. Click → detail view. For each line item: file upload widget for PSD (with progress bar), file upload widget for thumbnail, names text input, customization notes. Below items: payment_mode radio (prepaid/cod) + cod_amount input if cod. Submit disabled until every item has both files + names. On submit: persist all items, transition order to `in_production`, fire `order_in_production` or `_cod` template. Toast confirmation.

☐ **1.11 — Tab 2: In Production**
Route: `/(admin)/orders/in-production`. Cards or table view of orders where `state = 'in_production' AND deleted_at IS NULL`. Each card shows: order #, customer, items (each with thumbnail), payment, tags chip display, time-in-state. Filter chips: All / Fresh / QC Redo / Tagged. Read-only except for the actions in tasks 1.12-1.13.

☐ **1.12 — Tag management**
`lib/tags/sync.ts`. Admin page at `/(admin)/admin/tags` for managing the tag dictionary. On any order page: tag chip input. Each tag toggle includes "Show to customer?" checkbox (default from `tag_definitions.is_customer_visible_default`). On add/remove, write to `order_tags` + PUT to Shopify's order tags API. Webhook handler updates local tags from Shopify. Last-write-wins via `updated_at`.

☐ **1.13 — Mockup replacement (pre-QC only)**
Action on Tab 2 detail view: "Replace mockup files" for each item (visible only when no QC has happened on that item). Modal with PSD upload, thumbnail upload (either or both), reason dropdown, notes. On submit: write to `mockup_history`, update item URLs, increment `mockup_replaced_count`. If reason = `customer_requested_change` AND PSD was replaced → show "Send customer WhatsApp?" checkbox (default checked) → on submit, fire `mockup_updated` template.

☐ **1.14 — Admin order deletion (pre-QC)**
Soft-delete button on Tab 2 order detail (admin role only, visible only if no QC has happened on any item). Sets `deleted_at`, `deleted_by`, `delete_reason`. Order disappears from all tabs. Hard-purge cron will remove it after 30 days.

☐ **1.15 — Global search**
Endpoint `/api/search?q=...`. Matches `shopify_order_number` (exact + prefix), last 10 digits of `customer_phone`, or `order_tags.tag_name`. Returns up to 10 results with a hint of which tab to send the user to.

☐ **1.16 — Deploy to staging + smoke test**
Deploy to a staging branch on Cloudflare Pages. Configure all env vars (use sandbox Shopify store if possible). Smoke test: create a Shopify order, tag it, watch it appear, complete Tab 1, verify WhatsApp arrives (use `MOCK_INTERAKT` or a test number).

---

## Phase 2 — Close the loop (QC + Shipment)

**Goal:** Whole production cycle runs inside this app.

☐ **2.1 — Tab 3: QC (mobile-first)**
Route: `/(admin)/orders/qc`. Order # lookup input (numeric keypad on mobile). Renders order with items as vertical stack of cards. Each item card: large thumbnail (tap to zoom), names, customization, QC photo capture button (HTML `<input capture="environment">`), Pass button, Fail button. Pass requires photo. Fail requires reason. Progress indicator at bottom: "N of M items done". Bottom-pinned action buttons. Touch-friendly sizing.

☐ **2.2 — QC state logic + 1h grace**
Item Pass/Fail → update `order_items.qc_status`. Call `tryAdvanceFromItemQc(orderId)`. If all items pass → schedule `qc_passed` notification 1h out + show grace banner. If any item fails → fire `qc_failed_remaking` (only if not yet sent for this order). Failed items revert their `qc_status` to NULL on next QC attempt — they go back to "awaiting QC" state for the redo.

☐ **2.3 — Grace period UI**
Banner at top of Tab 3 when grace is active: "Notification pending in HH:MM — flip QC or send now". Live countdown. Two buttons: "Send now" (immediately fires + transitions order), "Cancel notification" (admin only — cancels send, leaves order in pre-grace state for QC re-do).

☐ **2.4 — Scheduled notifications cron**
Cloudflare Cron Trigger `/api/cron/process-scheduled-notifications` every minute. Selects from `notifications_log` where `status = 'scheduled' AND scheduled_for <= now()`. For each: transition order to target state (`qc_passed`), call Interakt, update notification status, append status history. Idempotent (`select ... for update skip locked`).

☐ **2.5 — Post-grace QC change (admin)**
On any order with `state IN ('qc_passed', 'shipped')`, admin can open "Reopen QC" — flips an item back to a failed status or re-runs QC. Triggers `qc_status_updated` follow-up template. Heavily logged in status history. Rare-use action — small button hidden behind a confirmation dialog.

☐ **2.6 — Tab 4: Shipment**
Route: `/(admin)/orders/shipment`. Rows for `state = 'qc_passed'`. Display: order #, customer, items count, payment + COD amount, tags (highlight `air-shipping`), manual tracking number field. "Shipment Label Generated" button → state → `shipped`, stamps timestamps. If tracking entered manually, save it. Otherwise wait for fulfillment webhook.

☐ **2.7 — Fulfillment webhook → tracking + shipped notification**
Handle `fulfillments/create` + `fulfillments/update`. Populate `tracking_number`, `tracking_url`, `tracking_carrier`, `tracking_source = 'shopify'`. If state ≥ `shipped` AND `order_shipped` template not yet sent → fire it now.

☐ **2.8 — Tab 5: Tracking (ops view)**
Route: `/(admin)/orders/tracking`. Table of shipped + delivered orders. Tracking link, carrier, source, last update, delivered timestamp. Sortable.

☐ **2.9 — Shipmozo fallback cron**
`lib/shipmozo/client.ts`. Cloudflare Cron at `/api/cron/shipmozo-poll` every 30 min. For each `shipped` order with empty tracking data > 2 h old, call Shipmozo. Update tracking fields, set `tracking_source = 'shipmozo'`. When delivery returned, transition to `delivered`.

☐ **2.10 — Role-based tab visibility**
Apply role gates per SPEC §6: `production` → 1+2; `qc` → 3 + read-only 2; `shipment` → 4 + read-only 5; `admin` → all.

---

## Phase 3 — Customer App (`track.sblossom.com`)

**Goal:** Customers stop asking "where's my order?" on WhatsApp.

☐ **3.1 — Customer login flow**
Route: `/(customer)/`. Order # + phone form. On submit: validate against `orders` (order number + last-10-digit phone match, `deleted_at IS NULL`). Generate 6-digit OTP, bcrypt-hash, store in `otp_codes` (10 min expiry). Send via `tracking_otp` Interakt template. Redirect to `/verify`.

☐ **3.2 — OTP verification + JWT session**
Route: `/(customer)/verify`. Single OTP input. Look up most recent unused OTP for this phone+order_number. Compare hash. On success: mark used, issue JWT in HttpOnly cookie scoped to that order. Redirect to `/track`. Enforce rate limits per SPEC §7 (3 OTP req per phone per 15 min; 5 wrong attempts per phone per hour).

☐ **3.3 — Tracking page**
Route: `/(customer)/track`. Read from `customer_order_view`. Stepper component (5 steps). Active step highlighted (maroon/pink brand colors). If `any_item_in_redo`, show subtle "Quality re-check in progress" note. If `shipped`, prominent tracking link button. Items grid below with thumbnails + names. Visible-tags chip row. Mobile-first.

☐ **3.4 — Call Me form**
Modal on tracking page. Reason dropdown (Change customization / Change address / Payment issue / Delivery question / Other), notes textarea, phone (prefilled). Submit → `call_requests` row. Rate limit: 3 per phone per 24 h. Confirmation toast.

☐ **3.5 — Customer app polish**
Loading states, error states, expired session UX. Lighthouse pass on mobile. `robots.txt` blocks all crawling.

---

## Phase 4 — Engagement & polish

☐ **4.1 — Interakt inbound webhook**
Handler at `/api/webhooks/interakt`. Verifies webhook with shared token. Processes two event types: delivery receipts (update `notifications_log.status`) and customer replies (create `call_requests` with reply text as `notes`, linked to order via phone lookup).

☐ **4.2 — Tab 6: Call Requests inbox**
Route: `/(admin)/call-requests`. Table per SPEC. Filter by status. Mark attended / dismiss. Polls every 30 s for new ones.

☐ **4.3 — New call request → team alert**
On insert, fire to `TEAM_ALERT_WEBHOOK` (Interakt group or Slack). Include reason + phone + order # link.

☐ **4.4 — Daily summary cron**
Cloudflare Cron at 03:30 UTC (09:00 IST). Computes the metrics from SPEC §11. Sends identical WhatsApp via Interakt template `daily_summary` to each active user's phone. Same content for everyone.

☐ **4.5 — Users admin page**
Route: `/(admin)/admin/users`. List, create, disable, change role. Password set on creation via the script-equivalent flow inside the UI (shows password once, admin saves it).

☐ **4.6 — Notifications log viewer**
Route: `/(admin)/admin/notifications`. Filter by template, status, order, phone. For debugging "did the customer get the WhatsApp?".

☐ **4.7 — Order history timeline**
Side panel on any order detail showing `order_status_history` entries with actor + time.

☐ **4.8 — Cleanup crons**
Cloudflare Cron daily at 02:00 IST: calls `purge_delivered_orders()`, `purge_soft_deleted_orders()`, `purge_old_webhook_events()`, `purge_old_call_requests()`. Hourly: `purge_expired_otps()`. **Important:** before each `purge_*_orders()` call, gather all R2 object keys from items + mockup history rows and delete those R2 objects too. Otherwise files orphan in storage forever.

☐ **4.9 — DB keep-alive cron**
Cloudflare Cron every 3 days: `select 1 from orders limit 1`. Prevents Supabase Free auto-pause. Belt-and-braces — your daily usage probably handles this anyway.

☐ **4.10 — Backfill script**
`scripts/backfill-shopify-orders.ts`. Fetch existing orders with `under production` tag from Shopify and insert into our DB with items.

☐ **4.11 — Production launch checklist**
- [ ] All 7 Interakt templates approved
- [ ] Webhooks registered in Shopify pointing at prod URLs
- [ ] Env vars set in Cloudflare Pages prod
- [ ] DB schema applied
- [ ] All 5 employees have accounts created via script
- [ ] DNS resolves for both subdomains
- [ ] One real order walked through Tab 1 → 4 end-to-end
- [ ] One real customer test on `track.sblossom.com` end-to-end
- [ ] Cron triggers all configured and confirmed firing

---

## Backlog (post-launch)

- Customer-facing mockup approval inside the app
- Bulk operations in Tab 4
- CSV export by date range / state
- Internal commenting on orders
- Hindi language toggle on customer app
- WhatsApp OTP 2FA for employees (if security needs justify it)
- Public `/order/:id/share` URL the customer can forward
