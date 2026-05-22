# Architecture Notes — Sblossom Ops & Tracking

A short doc explaining the design philosophy and the "why" behind decisions that might look surprising. Read this if you're a new developer (human or AI) joining the project and confused about choices.

## The single most important idea

**This database is a transient operational cache. Shopify is the system of record for orders.**

If you remember nothing else from this doc, remember that. Many design decisions flow from it:

- The 30-day TTL on completed orders is a feature, not a bug.
- We don't need PITR backups, because losing recent data is recoverable (re-ingest from Shopify) and losing old data is fine (it's already been delivered).
- We don't aggressively denormalize "for reporting" — if you want analytics over years of orders, query Shopify directly.
- The DB schema can be small, simple, and slim.

When you're tempted to add backup/archive features "just to be safe", stop and ask: would Shopify+files-in-R2 give us this back? Usually yes, so don't add it here.

## Why we picked this stack

### Cloudflare Pages over Vercel
- Free. Vercel Pro is $20/seat. For an app this small, the cost difference dominates.
- Unlimited bandwidth. Vercel's bandwidth overages have caught people off guard.
- Same vendor as R2 and DNS — one dashboard, one set of credentials.
- Trade-off: Next.js compatibility is ~95% via `@cloudflare/next-on-pages`. Some Node APIs don't work natively. For our use case (webhooks, DB queries, file uploads, basic React UI), it's fine.

### Supabase Free over Pro / Neon / self-host
- Free is genuinely sufficient because the DB is a transient cache (see above).
- 500 MB limit is far more than we'll ever use (~30 MB realistic peak).
- Auto-pause after 7 days inactivity is mitigated by daily team use + a keep-alive cron.
- We don't use Supabase Auth or Storage — only Postgres. Could swap to Neon in a day if we ever needed to. Sticking with Supabase for community/docs familiarity.

### R2 over S3/B2/Drive
- Zero egress fees. PSDs get re-downloaded by QC employees; egress would be a recurring cost on S3.
- S3-compatible API → standard tooling.
- Same vendor as Pages — one dashboard.
- B2 is cheaper per-GB but the savings at our scale are Rs. 50/mo and not worth the second vendor.

### NextAuth Credentials (email + password)
- 5 employees. Building Google SSO would have added a Google dependency and most of our team prefers email/password.
- Script-based account creation works fine at this scale. Admin UI in Phase 4.

## Why we made the QC choices we made

### Per-item QC, per-order state transitions
A single order can contain multiple personalized items. Each has its own mockup, its own names, its own failure modes. We track QC at the item level so a single bad item doesn't force the whole order to be remade.

But customers don't want N WhatsApp messages for an N-item order. So state transitions and customer notifications are at the order level — the order only moves to `qc_passed` when every item has passed.

### 1-hour QC grace window
Catches the "oh shit, wrong button" scenario without slowing down the QC flow. Costs nothing (one scheduled DB row + a cron). The cron job that processes scheduled notifications also catches a class of "delayed notification" needs cleanly.

If a QC employee flips a decision during grace, the timer resets. After grace, only admins can change QC status (and doing so triggers a follow-up WhatsApp). This balances correctness (catch mistakes) with finality (the customer doesn't get notified twice without explanation).

### `qc_failed_remaking` sent only once per order
If an order has 3 items and 2 fail, we don't send the customer 2 "remaking" messages. The customer doesn't care which specific item failed — just that something went back into production. One message per order, period. Even if the same order goes through 5 redo cycles, only one notification ever fires.

The check is in code: query `notifications_log` for prior sends of this template for this order before queueing a new one.

## Why tags are bidirectional

Sblossom wants two things:
1. Internal-only tags (e.g., `replacement`, `priority`, `air-shipping-paid`) for ops workflow.
2. Customer-visible tags (e.g., `priority`, `gift-wrap`, `air-shipping`) shown on the tracking page.

Either of these alone is easy. Together, we need:
- Tags stored in our DB (with a `is_customer_visible` flag per association).
- Tags sync'd to Shopify so support agents looking at Shopify see what we see.

The sync is bidirectional with last-write-wins via `updated_at`. To prevent infinite sync loops:
- When we push tags to Shopify, stamp `orders.last_tag_push_at = now()`.
- When the resulting `orders/updated` webhook arrives within 30 s of `last_tag_push_at`, ignore the tag changes.

Customer-visibility is local-only (Shopify has no equivalent concept). When a new tag arrives from Shopify, it defaults to internal-only — admin can flip it to customer-visible later.

## Why the customer app does OTP login

You can't just take "order # + phone" as proof of identity, because order numbers are sequential and phone numbers leak in many places. Adding an OTP step closes the hole at low cost (Rs. 0.15 per login, ~10 seconds extra UX).

OTPs are sent via Interakt (already in our stack) and use the `tracking_otp` AUTHENTICATION template which is cheaper than utility messages.

## Why the daily summary goes to everyone

In a 5-person company, role-specific reporting is overkill. Everyone benefits from seeing the whole picture — production sees what's piling up in shipment, shipment sees what's coming, admin sees everything. The summary is one cron job, one Interakt send to each of the 5 phones.

## Things that intentionally don't exist

These are NOT missing features. They're deliberate omissions:

- **No order cancellation flow.** Admin deletes pre-QC. Post-QC is handled in Shopify directly (cancel the Shopify order, optionally create a replacement order with appropriate tags).
- **No RTO / returns workflow.** Personalized products aren't returnable. If something's wrong, admin creates a replacement Shopify order with tag `replacement`.
- **No PITR backups, no archive, no 90+ day retention.** See "transient cache" principle above.
- **No multi-tenancy.** Single shop, single brand, single workflow.
- **No multi-language UI.** English only at launch. Hindi toggle is a Phase 4+ backlog item.
- **No 2FA on employee login.** 5 trusted in-office employees. Can add WhatsApp OTP 2FA in Phase 4 if needed.
- **No employee mobile app.** Web app is responsive. Tab 3 (QC) is mobile-first; others are desktop-first.
- **No customer accounts / order history.** Customer authenticates per-order via OTP. Each session sees one order. No persistent account.

## Decisions to revisit later

These are worth checking in 6-12 months:

- **30-day TTL.** If your customer support hears "I lost my mockup, can you remake?" frequently, extend the TTL on `order_items` to 180 days.
- **Mockup history retention.** If your team relies on the history table for audit, extend from 30 to 90 days.
- **R2 storage class.** If files older than 30 days are rarely accessed, move them to R2 Infrequent Access ($0.01/GB vs $0.015/GB).
- **Supabase Free vs Pro.** If you hit any auto-pause incidents or want PITR, upgrade. Threshold: any single incident of "the DB was unreachable for X minutes during business hours".
- **Vercel switch.** If Cloudflare adapter quirks become a daily annoyance, switch to Vercel Pro. Threshold: > 5% of dev time spent on platform issues.

## What "good" looks like in this codebase

A few aesthetic principles for whoever's writing the code:

1. **Boring is better.** This isn't a place to try new patterns. Standard Next.js, standard Drizzle, standard Tailwind. Future-you (or the next developer) will thank you.
2. **Small files, clear names.** A file should do one thing. Name files for what they do, not what they are.
3. **One way to do each thing.** Don't have three patterns for fetching data. Pick one and stick to it.
4. **Errors loudly, fail fast.** Throw on missing env vars at startup. Throw on invalid state transitions. Don't paper over with `try { } catch { /* swallow */ }`.
5. **Comments explain WHY, not WHAT.** The code shows what it does. Comments are for the reasoning behind it.

That's it. Build the system, ship it, then move on to building Sblossom's actual product.
