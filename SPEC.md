# Sblossom Operations & Tracking System — Specification (v2)

> **Architecture note:** This system is an **operational cache layered on top of Shopify**, not a system of record. Shopify owns order data. This system owns production workflow state (mockup files, QC outcomes, internal notes, notifications). Completed orders are deleted after 30 days — this is by design, not a missing feature.

## 1. Overview

A two-part web application supporting Sblossom's manufacturing and customer-communication workflow.

- **Part 1 — Internal Ops App** hosted at `admin.sblossom.com`. Used by Production, QC, and Shipment teams (5 people total).
- **Part 2 — Customer Tracking App** hosted at `track.sblossom.com`. Used by customers to track their personalized order and request a callback.

## 2. Stack

- **Hosting:** Cloudflare Pages (free tier, commercial use OK)
- **Frontend/backend:** Next.js 15, App Router, TypeScript (strict mode), React Server Components by default
- **UI:** Tailwind CSS + shadcn/ui
- **Database:** Supabase Free tier (Postgres). DB is transient ops cache — no PITR needed.
- **File storage:** Cloudflare R2 (S3-compatible)
- **Cron:** Cloudflare Cron Triggers (replaces Vercel Cron)
- **Auth (employees):** NextAuth Credentials provider, bcrypt password hashing
- **Auth (customers):** Order # + phone + WhatsApp OTP via Interakt
- **Integrations:** Shopify Admin API + webhooks, Interakt WhatsApp API (already set up), Shipmozo tracking API
- **Adapter:** `@cloudflare/next-on-pages` for Next.js → Cloudflare Workers runtime

## 3. Architecture

```
              ┌──────────────────────────────────────┐
              │  Shopify (sblossom.com) — source of  │
              │  truth. Order placed → admin tags it │
              │  "under production" after confirm.   │
              └──────────────────┬───────────────────┘
                                 │ webhook
                                 ▼
┌────────────────────────────────────────────────────────────────┐
│           Next.js App on Cloudflare Pages (single codebase)    │
│                                                                │
│   admin.sblossom.com       │       track.sblossom.com         │
│   (5 employees, role-based)│       (customers, order+OTP)     │
│                                                                │
│            Shared: Supabase Postgres, R2 storage               │
└─────────┬──────────────────────────────────────────┬───────────┘
          │                                          │
          ▼                                          ▼
   Interakt (WhatsApp)                       Shipmozo (tracking)
```

## 4. Order Lifecycle (State Machine)

Every order has a `state` field. State transitions are logged in `order_status_history`.

```
                  Shopify order tagged "under production" after admin confirm
                                  │
                                  ▼
                         approval_pending
                                  │  (Tab 1: per-item mockup + names + customization,
                                  │   WhatsApp sent to customer)
                                  ▼
                          in_production ◄────────┐
                                  │               │
                          (Tab 3: per-item QC)    │ Any item QC failed →
                                  │               │ item goes back, order stays
                       all items QC passed?       │ in_production with "QC Redo"
                                  │               │
                                  ▼               │
                       1h grace period ───────────┘ (if any QC flipped
                                  │                  during grace)
                                  ▼
                              qc_passed
                                  │
                          (Tab 4: shipment label generated)
                                  ▼
                              shipped
                                  │
                          (Shipmozo / Shopify webhook)
                                  ▼
                             delivered
                                  │
                            (after 30 days)
                                  ▼
                          [PURGED FROM DB]
```

### Key rules

- **Admin confirms an order** in Shopify by adding the `under production` tag. This is the trigger for our system to ingest it.
- **QC is per-item**, but state transitions are per-order. The order only moves to `qc_passed` when *every* item in it has a Pass status.
- **A failed item** goes back into the production queue independently. Items already passed wait in a "QC done, awaiting siblings" state.
- **1-hour grace period** after the last item passes QC: during this window, QC status can be flipped by any QC employee. The customer WhatsApp is queued, not sent immediately. If a flip happens, the timer resets.
- **Admin-only deletion** allowed before QC. After QC, no deletion.
- **30-day TTL** after `delivered_at`: cron job purges orders + related rows + R2 files.

## 5. Data Model

See `schema.sql` for the authoritative schema. High-level structure:

### `orders` (shipment-level state)
- Shopify IDs, customer info, shipping address (JSONB), payment mode, COD amount, total
- `state`, `last_qc_status` (derived), `qc_attempts` (max across items)
- Shipment fields: tracking number, URL, carrier, source, shipped_at, delivered_at
- Soft-delete fields: `deleted_at`, `deleted_by` (admin pre-QC deletion)
- Audit: `created_at`, `updated_at`, `tab1_completed_at`, `tab1_completed_by`

### `order_items` (per-line-item state)
- `order_id`, `shopify_line_item_id`, `title`, `variant_title`, `sku`, `quantity`
- `mockup_source_url` (PSD, up to 1000 MB), `mockup_thumbnail_url` (PNG/JPG, up to 5 MB)
- `mockup_uploaded_at`, `mockup_replaced_count`
- `names_text`, `customization_notes`
- `qc_status` (nullable: `passed` | `failed` | null), `qc_failure_reason`, `qc_photo_url`, `qc_at`, `qc_by`

### `mockup_history`
Captures pre-QC mockup replacements. Append-only.
- `order_item_id`, `previous_source_url`, `previous_thumbnail_url`
- `source_replaced` (bool), `thumbnail_replaced` (bool)
- `reason` (enum from dropdown), `notes` (free text)
- `replaced_at`, `replaced_by`

### `order_tags`
Flexible tagging. Some tags are internal-only, some are customer-visible. Tags sync back to Shopify.
- `order_id`, `tag_name`, `is_customer_visible`, `created_at`, `created_by`

### `tag_definitions`
Admin-managed list of allowed tag names.
- `name` (unique), `is_customer_visible_default`, `created_by`

### `order_status_history`
Append-only log of every state change. `order_id`, `from_state`, `to_state`, `actor_user_id`, `reason`, `metadata` (JSONB), `created_at`.

### `users` (employees)
- `id`, `email`, `password_hash` (bcrypt), `name`, `role`, `is_active`, `last_login_at`, timestamps
- Roles: `production` | `qc` | `shipment` | `admin`

### `call_requests`
- `order_id` (nullable), `customer_phone`, `customer_name`, `reason`, `notes`, `status`, `attended_by`, `attended_at`, `created_at`

### `notifications_log`
All Interakt sends with full request/response. `order_id`, `channel`, `template_key`, `recipient_phone`, `payload`, `response`, `status` (`queued` | `scheduled` | `sent` | `failed` | `cancelled`), `scheduled_for` (for 1h grace queue), `sent_at`, `error_message`, `created_at`.

### `otp_codes`
Hashed customer OTPs. `phone`, `order_number`, `code_hash`, `expires_at`, `used_at`, `attempts`.

### `shopify_webhook_events`
Append-only audit of incoming webhooks. `topic`, `shopify_order_id`, `webhook_id` (unique), `raw_body`, `processed_at`, `error_message`.

## 6. Internal App — `admin.sblossom.com`

### Global UI
- Top nav: Sblossom logo, tab list, global search, current user + role + logout.
- **Global search:** matches order number (exact + prefix), phone (last 10 digits), or tag name.
- Role visibility:
  - `production` → Tab 1, Tab 2
  - `qc` → Tab 3, Tab 2 (read-only)
  - `shipment` → Tab 4, Tab 5 (read-only)
  - `admin` → all tabs + Call Requests + Users + Tag Definitions
- All actions audit-logged.

### Tab 1 — Order Create
**Source list:** Shopify orders tagged `under production`, not yet in our DB or present with state `approval_pending`.

**Workflow for a multi-item order:**
1. Employee picks order from list (or pastes order # in search).
2. Detail panel shows customer info from Shopify + a list of all line items.
3. For each line item: PSD upload (max 1000 MB), thumbnail upload (max 5 MB), names text, customization notes.
4. Below items: payment mode (`prepaid` / `cod`), COD amount (auto-filled from Shopify total if COD).
5. Submit button is disabled until *every* item has both files + names.
6. On submit:
   - All item data persisted to `order_items`.
   - Order state → `in_production`.
   - One Interakt template `order_in_production` (or `_cod` variant) sent to customer.
   - Status history logged.

**Validation:** Each item needs PSD + thumbnail + names. COD amount required if payment is COD.

### Tab 2 — In Production
**Source list:** orders where `state = 'in_production' AND deleted_at IS NULL`.

**Display:** Card per order. Each card shows: order #, customer name, items (each with thumbnail, names, QC badge if applicable), payment, tags, time in production.

**Filters:** All / Fresh / QC Redo (any item failed) / Tagged (with sub-filter by tag).

**Actions:**
- **Replace mockup files** (pre-QC only) — modal per-item to upload new PSD, new thumbnail, or both. Requires reason. Logs to `mockup_history`. If reason = "Customer requested change" AND PSD was replaced → optional checkbox to send `mockup_updated` WhatsApp to customer (default: checked).
- **Add/remove tags** — via tag chip input. Each tag can be marked internal or customer-visible at time of add. Tags sync to Shopify.
- **Delete order** (admin only, pre-QC only) — soft-deletes the order. Hides from all tabs. Hard-purged after 30 days.

### Tab 3 — QC (Mobile-First)
**Source list:** orders in `in_production` with at least one item not yet QC'd.

**Mobile-first design:** large tap targets, single column, camera-friendly. Desktop also works.

**Workflow:**
1. Employee enters order # (numeric keypad on mobile).
2. Screen shows the order with items as a vertical stack of cards.
3. Each item card shows: large thumbnail (tap to zoom), names text, customization, prior QC failure reason if redo, "Download PSD" button.
4. Each item has: **Photo capture** (camera input, required for Pass), **Pass** button, **Fail** button.
5. Pass requires a photo. Fail requires a reason (text input), photo optional.
6. As items are QC'd, the bottom of the screen shows progress: "2 of 3 items done".

**On all items completed:**
- If all Pass → start 1-hour grace period:
  - `qc_passed` Interakt template queued (status = `scheduled`, `scheduled_for = now + 1h`).
  - Banner on Tab 3: "Notification pending in HH:MM — tap to change QC or send now."
  - During grace: any QC employee can flip an item's status. Timer resets.
  - After grace elapses with no flips: notification sends, order state → `qc_passed`, order moves to Tab 4.
- If any Fail → `qc_failed_remaking` Interakt template fires immediately (but only **once per order** even if multiple items fail in this round or in subsequent rounds). Failed items go back to production. Order stays in `in_production` with "QC Redo" badge.

**Post-grace QC changes (admin-only):**
- Admin can re-open an order's QC and flip statuses even after notification sent.
- Doing so triggers a follow-up `qc_status_updated` WhatsApp to customer.
- Logged loudly in status history.

### Tab 4 — Shipment
**Source list:** orders where `state = 'qc_passed'`.

**Display per row:** Order #, customer name, items count, payment mode, COD amount, tags (especially `air-shipping` highlighted), tracking number field (optional manual entry).

**Action:** "Shipment Label Generated" button → state → `shipped`, `shipment_label_generated_at` + `shipped_at` stamped. If tracking number was manually entered, save it. Otherwise wait for Shopify fulfillment webhook to populate.

### Tab 5 — Tracking
**Source list:** orders where `state IN ('shipped', 'delivered')`, sorted by `shipped_at DESC`.

Read-only ops view. Tracking carrier, number, URL, source, last status update, delivered timestamp.

**Backend:** Shopify fulfillment webhooks (primary). Shipmozo polling cron every 30 min for `shipped` orders with no tracking data older than 2 h (fallback).

### Tab 6 — Call Requests
Inbox of customer callback requests. Filter by status. Mark attended / dismiss. New requests trigger an alert to a team WhatsApp group via Interakt.

### Admin pages
- `/admin/users` — list, create, disable employees (Phase 4; Phase 1 uses script)
- `/admin/tags` — define allowed tags, set defaults for customer-visibility
- `/admin/notifications` — debug viewer for `notifications_log`

## 7. Customer App — `track.sblossom.com`

### Login flow
Order # + phone → validate match → generate 6-digit OTP → store hash in `otp_codes` (10 min expiry) → send via Interakt `tracking_otp` template → customer enters OTP → JWT session (24 h) scoped to that order.

Rate limit: 3 OTP requests per phone per 15 min; 5 wrong OTP attempts per phone per hour.

### Tracking page
Mobile-first stepper:
```
●───────●───────●───────●───────●
Approval  In       QC      Shipped Delivered
Pending   Production   Done
```

State mapping:
- `approval_pending` → "Approval Pending" active
- `in_production` (no QC redo) → "In Production" active
- `in_production` with any item QC redo → "In Production" active + "Quality re-check in progress" subtext
- `qc_passed` → "QC Done" active
- `shipped` → "Shipped" active + tracking link button
- `delivered` → "Delivered" active

Below stepper:
- **Customer-visible tags** — chip display, only tags marked `is_customer_visible = true` show. (Internal tags like `air-shipping-paid` are hidden; customer-facing ones like `priority`, `air-shipping`, `gift-wrap` show.)
- **Order summary** — items with thumbnails, names, total, payment mode.
- **Call Me button** — opens modal with reason dropdown + notes + phone (prefilled). Submit creates `call_requests` row.

## 8. Integrations

### Shopify
- Custom app, scopes: `read_orders`, `write_orders` (for tag sync), `read_fulfillments`, `read_customers`.
- Webhooks: `orders/create`, `orders/updated`, `fulfillments/create`, `fulfillments/update`.
- HMAC verification mandatory.
- Idempotency via `X-Shopify-Webhook-Id` unique constraint.
- **Tag sync:** when employee adds/removes a tag in our app, we PUT to Shopify's order tag endpoint to mirror the change. When Shopify's `orders/updated` arrives with changed tags, we mirror back into our DB. Last-write-wins by `updated_at` to avoid loops.

### Interakt (already provisioned)
- Secret Key from `app.interakt.ai/settings/developer-setting` → env var `INTERAKT_API_KEY`.
- All sends via `lib/interakt/client.ts` with internal rate limit: **max 35 req/min** (under Interakt's 40 req/min cap, with safety margin).
- Configure webhook at `https://admin.sblossom.com/api/webhooks/interakt` to receive delivery receipts and inbound replies.
- Templates: see `interakt_templates.md` for the 7 templates to submit.

### Shipmozo
- Tracking fallback only. Cron every 30 min for `shipped` orders missing tracking data > 2 h old.

### Cloudflare R2
- Buckets: `sblossom-mockups` (PSDs + thumbnails), `sblossom-qc-photos`.
- Multipart upload (mandatory for files > 100 MB).
- Presigned URLs for both upload (PUT) and view (GET, 1 h expiry).
- Direct browser → R2 uploads (no proxy through app server — Cloudflare Workers has 100 MB request body limit).
- Cleanup cron: deletes orphan files when their parent order is purged at the 30-day mark.

## 9. Auth & Roles

### Employees
- Email + password via NextAuth Credentials provider.
- bcrypt cost factor 12.
- Min password length 8 chars. No complexity rules. No expiry/rotation.
- 5 wrong attempts → 15 min lockout (tracked in `users.failed_login_attempts` + `lockout_until`).
- Session: 8 h idle expiry, JWT.
- Account creation via `pnpm tsx scripts/create-user.ts` (Phase 1).
- Password reset via `pnpm tsx scripts/reset-password.ts <email>` (Phase 1).
- Admin UI for both (Phase 4).
- **Individual accounts only.** No shared logins.
- No 2FA in Phase 1. WhatsApp OTP 2FA can be added in Phase 4 if needed.

### Customers
- Order # + phone + WhatsApp OTP. JWT session scoped to single order.

## 10. WhatsApp Templates (Interakt)

See `interakt_templates.md` for paste-ready text. 7 templates:

| Key | Trigger | Sends to | When |
|---|---|---|---|
| `order_in_production` | Tab 1 submit (prepaid) | Customer | Immediately |
| `order_in_production_cod` | Tab 1 submit (COD) | Customer | Immediately |
| `qc_passed` | All items pass QC | Customer | After 1h grace period |
| `qc_failed_remaking` | First item failure in QC | Customer | Immediately, once per order |
| `order_shipped` | Tab 4 / Shopify fulfillment | Customer | Immediately |
| `mockup_updated` | Mockup replaced (reason: customer change) | Customer | Optional, opt-out per replacement |
| `tracking_otp` | Customer login | Customer | Immediately |

Plus internal Slack/WhatsApp group notifications for new call requests (no template needed if using webhook).

## 11. Daily summary

Cron at 9:00 AM IST (3:30 UTC) sends one identical WhatsApp summary to each of the 5 employees:

```
Sblossom Daily — DD MMM YYYY

In Production: N (M QC redo)
Awaiting QC: N
Awaiting Shipment: N
Stuck >3 days: N ⚠️
Open call requests: N

Yesterday: N shipped, N entered production
QC pass rate (7d): NN%
```

Uses utility template `daily_summary`. (8th template — confirmed during build, optional to draft now if you want it ready Phase 4.)

## 12. Non-functional

### Logging
- Notifications: full request/response in `notifications_log`.
- State changes: `order_status_history`.
- Webhooks: raw body in `shopify_webhook_events` before processing.

### Security
- Secrets in env vars only.
- Webhook HMAC verification mandatory.
- OTP codes hashed at rest.
- Rate limits: customer login, call-me submissions, Interakt sends.
- HTTPS only.

### Performance
- Order list views paginated (default 25/page).
- Customer tracking page: server-rendered, < 1.5 s on 3G.
- R2 cached via Cloudflare CDN automatically.

### Data lifecycle (the architectural design)
- `orders` + `order_items` + `mockup_history` + `notifications_log` + `order_status_history`: deleted 30 days after `delivered_at`.
- `call_requests`: kept for 90 days (might reference deleted orders via `order_id` set to NULL).
- `users`, `tag_definitions`: never deleted.
- `otp_codes`: deleted after `used_at` or `expires_at`, whichever comes first.
- `shopify_webhook_events`: kept for 7 days then purged.

## 13. Environment Variables

```
# Cloudflare
CF_ACCOUNT_ID=
CF_API_TOKEN=

# Supabase
DATABASE_URL=
DIRECT_URL=

# Shopify
SHOPIFY_STORE_DOMAIN=sblossom.myshopify.com
SHOPIFY_ADMIN_ACCESS_TOKEN=
SHOPIFY_WEBHOOK_SECRET=

# Interakt (already provisioned)
INTERAKT_API_KEY=
INTERAKT_WEBHOOK_VERIFY_TOKEN=    # secret you set in Interakt's webhook config

# Shipmozo
SHIPMOZO_API_KEY=
SHIPMOZO_API_SECRET=
SHIPMOZO_BASE_URL=

# R2
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_MOCKUPS_BUCKET=sblossom-mockups
R2_QC_PHOTOS_BUCKET=sblossom-qc-photos
R2_PUBLIC_BASE_URL=

# Auth
NEXTAUTH_SECRET=
NEXTAUTH_URL=https://admin.sblossom.com
CUSTOMER_JWT_SECRET=

# Notifications
TEAM_ALERT_WEBHOOK=               # WhatsApp group webhook for new call requests
```

## 14. Out of scope (Phase 1)

- Customer-facing mockup approval flow (currently outside this system).
- Refunds / cancellations workflow inside our app (admin deletes pre-QC and creates replacement orders in Shopify directly).
- RTO / returns (out of scope — these are personalized products, no returns accepted, replacements handled via fresh Shopify orders).
- Inventory management.
- In-app chat with customer.
- Hindi language toggle (Phase 4 candidate).
