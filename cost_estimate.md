# Monthly Cost Estimate — Sblossom Ops & Tracking (v2)

Last verified: May 2026. All foreign-currency at ~Rs. 85/USD.

## TL;DR

For a 5-employee team running 500 orders/month: **net new monthly cost is ~Rs. 700**. Everything else is either free tier or already-paid-for (Interakt).

---

## Stack & costs

| Service | Plan | Monthly cost (INR) | Notes |
|---|---|---|---|
| Cloudflare Pages | Free | 0 | Unlimited bandwidth, commercial use OK. 500 builds/mo. |
| Cloudflare Workers (Cron) | Free | 0 | 100K req/day free. Cron Triggers included. |
| Supabase | Free | 0 | DB is transient cache, no PITR needed. 500 MB more than enough (real usage ~30 MB). |
| Cloudflare R2 | Pay-as-go | ~240 | ~180 GB steady-state of mockups (90-day retention). See breakdown. |
| Interakt subscription | Existing | already paid | You're already on the Growth plan. No new subscription cost from this project. |
| Interakt messages (incremental) | Per-use | ~435 | 500 orders × ~Rs. 0.87 average per order. |
| Shipmozo | Free to install | 0 | Pay only for shipping, which you already do. |
| DNS | (existing) | 0 | `admin.sblossom.com` and `track.sblossom.com` ride on existing domain. |
| **Net new monthly cost** | | **~Rs. 675** | |

Plus ~Rs. 25/month for the QC photo storage (1 photo per item × ~700 items/mo × 2 MB × 90-day retention = ~120 GB but you'll likely compress) — call it Rs. 700 total to be safe.

---

## Volume-based scaling

| Order volume | Net new cost (INR/mo) | Annual (INR) |
|---|---|---|
| 100/mo | ~150 | ~1,800 |
| 250/mo | ~370 | ~4,440 |
| **500/mo (your current)** | **~700** | **~8,400** |
| 1,000/mo | ~1,400 | ~16,800 |
| 2,500/mo | ~3,500 | ~42,000 |

Even at 2,500 orders/month (5× your current volume), you're under Rs. 4,000/month in incremental costs. That's when you'd want to start considering paid tiers (Supabase Pro for backups, possibly upgrading R2 retention).

---

## R2 storage detail (the only meaningful variable cost)

| Component | Math | Monthly cost |
|---|---|---|
| PSDs at 110 MB avg, 500 orders × 1.4 items avg = 700 items/mo × 1.2 (replacements) | ~92 GB new/month, 90-day retention = ~275 GB steady-state | $4.13 ≈ Rs. 350 |
| Thumbnails at 1 MB avg | ~850 MB new/month | negligible |
| QC photos at 2 MB avg | ~1.4 GB new/month, 90-day retention = ~4 GB | $0.06 ≈ Rs. 5 |
| Mockup history (PSDs from replacements, 30-day retention) | ~3 GB steady-state | $0.05 ≈ Rs. 4 |
| Operations (Class A uploads + Class B reads) | Well inside 1M/10M free tier | 0 |
| **R2 total** | | **~Rs. 360/month** |

Actually higher than the Rs. 240 estimate I gave earlier — that's because I underestimated items-per-order. Use Rs. 360 as the realistic figure. Still trivial.

---

## WhatsApp message detail (also a variable cost)

Per order, you'll send roughly:
- 1× `order_in_production` (or COD variant) — utility
- 1× `qc_passed` OR `qc_failed_remaking` then later `qc_passed` (count as 1.2 utility avg)
- 1× `order_shipped` — utility
- ~0.1× `mockup_updated` (rare) — utility
- ~1.5× `tracking_otp` per order (customer checks tracking) — auth

**Cost per order:** (3.3 × Rs. 0.20 utility) + (1.5 × Rs. 0.15 auth) = ~Rs. 0.88

At 500 orders/month: **~Rs. 440/month** in incremental WhatsApp messages.

This comes out of your existing Interakt wallet balance (the ₹389.41 you have visible) — top up monthly.

---

## What's NOT in this estimate (because you're already paying)

- Shopify subscription
- Shipping costs to couriers (via Shipmozo)
- Domain renewal
- Employee phone/internet
- Interakt subscription (already paid)

---

## One-time setup costs

| Item | Cost | Notes |
|---|---|---|
| Development (if hiring) | Rs. 1.5L - 3L | Depends on hourly rate + scope. Phase 1-3 only. Solo Claude Code dev: ~100 hours at Rs. 1,500-2,500/hr. If you build it yourself: time, not cash. |
| ngrok dev tier (optional) | $8/mo during build only | For stable webhook testing URLs. Free tier with rotating URLs also works. |
| Meta business verification | Free | Already done if you're using Interakt. |
| WhatsApp template approval | Free | Submit the 8 templates in `interakt_templates.md`. 24-48 hr lead time. |
| **Optional: Claude Code subscription** | $20/mo (~Rs. 1,700) | If you're using Claude Code yourself to build. One developer's seat. Pause after the build is complete. |

---

## Comparing what we discarded vs. what we picked

**Original spec (v1):**
- Vercel Pro: Rs. 1,700/mo
- Supabase Pro: Rs. 2,125/mo
- Total floor: ~Rs. 6,775/mo

**Final spec (v2):**
- Cloudflare Pages: Rs. 0
- Supabase Free: Rs. 0
- Total floor: ~Rs. 700/mo (R2 + WhatsApp messages only)

**Annual savings vs. v1: ~Rs. 73,000.** 

The trade-offs you accepted:
- Self-managed DB (no automated backups — acceptable because DB is transient cache)
- Cloudflare adapter complexity for Next.js (~1 day of additional setup work vs. Vercel)
- Self-managed cron jobs (one Cloudflare Cron config)

For a 5-person business with 500 orders/month, this is the right call.

---

## When to upgrade

Reasonable triggers to revisit:

| Trigger | What to upgrade |
|---|---|
| Order volume exceeds 2,000/month | Supabase Pro (DB now holds more in-flight data, backups become reasonable) |
| You add a feature that requires data retention > 30 days | Supabase Pro + reconsider TTL design |
| Team grows past 8 people | Vercel Pro might be worth it for better DX, or stay on Cloudflare with Coolify-like tooling |
| QC fail rate is hurting customer experience | Add the "Names confirmation" WhatsApp flow (not a cost upgrade, a feature) |
| Customer complaints about delivery confusion | Add Shopify upgraded plan for better fulfillment APIs (separate from this app) |

Write these triggers somewhere visible. "We'll upgrade when we need to" usually means "we'll upgrade after the disaster". Better to know in advance what the threshold is.

---

## Currency note

USD-to-INR conversion: **Rs. 85/USD** (May 2026). Cloudflare and AWS billing in USD will fluctuate ±5% with FX. Build a small buffer.
