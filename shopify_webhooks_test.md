# Shopify Webhook Test Harness — Sblossom Ops (v2)

Local dev + test resources for the Shopify webhook handlers.

## How Shopify webhooks work (60s version)

Shopify POSTs JSON to your URL with headers:
- `X-Shopify-Topic` — event (e.g. `orders/create`)
- `X-Shopify-Hmac-Sha256` — base64 HMAC of raw body
- `X-Shopify-Shop-Domain` — sending shop
- `X-Shopify-Webhook-Id` — unique delivery ID (use for idempotency)
- `X-Shopify-Order-Id` — order ID when applicable

Verify by:
1. Read RAW body (bytes, not parsed JSON — key order matters).
2. HMAC-SHA256(secret, raw_body), base64-encode.
3. Constant-time compare to header value.

If mismatch: return 401 and log.

---

## Sample payload 1 — `orders/create` (multi-item)

Save as `samples/order_create_multi.json`.

```json
{
  "id": 5847291938273,
  "admin_graphql_api_id": "gid://shopify/Order/5847291938273",
  "name": "#1042",
  "order_number": 1042,
  "created_at": "2026-05-22T10:42:17+05:30",
  "updated_at": "2026-05-22T10:42:17+05:30",
  "currency": "INR",
  "current_total_price": "2598.00",
  "total_price": "2598.00",
  "financial_status": "paid",
  "fulfillment_status": null,
  "tags": "under production",
  "note": "Cursive font for both pieces",
  "email": "priya.sharma@example.com",
  "phone": null,
  "customer": {
    "id": 6273849201,
    "first_name": "Priya",
    "last_name": "Sharma",
    "email": "priya.sharma@example.com",
    "phone": "+919876543210"
  },
  "shipping_address": {
    "first_name": "Priya",
    "last_name": "Sharma",
    "address1": "B-204, Sunshine Apartments",
    "address2": "Sector 42",
    "city": "Gurugram",
    "province": "Haryana",
    "country": "India",
    "zip": "122002",
    "phone": "+919876543210"
  },
  "line_items": [
    {
      "id": 14728391029384,
      "product_id": 9221345678901,
      "variant_id": 47382910283746,
      "title": "Personalized Wooden Name Plate",
      "variant_title": "12x18 inch",
      "quantity": 1,
      "price": "1299.00",
      "sku": "SB047-12x18",
      "properties": [
        { "name": "Names", "value": "Sharma Family" },
        { "name": "Font Style", "value": "Cursive" }
      ]
    },
    {
      "id": 14728391029385,
      "product_id": 9221345678902,
      "variant_id": 47382910283747,
      "title": "Personalized Wooden Name Plate",
      "variant_title": "10x14 inch",
      "quantity": 1,
      "price": "1299.00",
      "sku": "SB047-10x14",
      "properties": [
        { "name": "Names", "value": "The Patels" },
        { "name": "Font Style", "value": "Cursive" }
      ]
    }
  ]
}
```

### Mapping (Shopify → DB)

**`orders` table:**
| Shopify | Our column |
|---|---|
| `id` | `shopify_order_id` |
| `order_number` | `shopify_order_number` |
| `name` | `shopify_order_name` |
| `tags` (CSV → array, trim each) | `shopify_tags` |
| `customer.first_name + ' ' + customer.last_name` | `customer_name` |
| `customer.phone` || `shipping_address.phone` (normalize to E.164) | `customer_phone` |
| `customer.email` | `customer_email` |
| `shipping_address` | `shipping_address` |
| `total_price` | `total_amount` |
| `currency` | `currency` |

**`order_items` table — one row per `line_items` entry:**
| Shopify | Our column |
|---|---|
| `id` | `shopify_line_item_id` |
| `title` | `title` |
| `variant_title` | `variant_title` |
| `sku` | `sku` |
| `quantity` | `quantity` |
| `price` | `unit_price` |

Mockup URLs, names, customization, QC fields are filled in later by Tab 1, not from the webhook.

**Trigger condition:** Only ingest if `tags.split(',').map(trim).includes('under production')` AND no row exists for `shopify_order_id`. Otherwise update existing.

---

## Sample payload 2 — `orders/updated`

Same shape as `orders/create`. Used to detect:
1. New tag added (specifically `under production`) → ingest fresh.
2. Existing order's tags changed → mirror to our `order_tags` (last-write-wins via `updated_at`).

**Important:** updates from `orders/updated` should NEVER touch workflow state fields (`state`, `qc_*`, `tab1_*`, etc.). Those are owned by our app.

---

## Sample payload 3 — `fulfillments/create`

Save as `samples/fulfillment_create.json`.

```json
{
  "id": 4827361923847,
  "order_id": 5847291938273,
  "status": "success",
  "created_at": "2026-05-23T14:22:11+05:30",
  "updated_at": "2026-05-23T14:22:11+05:30",
  "tracking_company": "Delhivery",
  "tracking_number": "7891234567",
  "tracking_numbers": ["7891234567"],
  "tracking_url": "https://www.delhivery.com/track/package/7891234567",
  "tracking_urls": ["https://www.delhivery.com/track/package/7891234567"],
  "shipment_status": "in_transit",
  "line_items": [
    { "id": 14728391029384, "quantity": 1, "fulfillable_quantity": 0 },
    { "id": 14728391029385, "quantity": 1, "fulfillable_quantity": 0 }
  ]
}
```

**Mapping:**
| Shopify | Our column |
|---|---|
| `tracking_number` | `tracking_number` |
| `tracking_url` | `tracking_url` |
| `tracking_company` | `tracking_carrier` |
| literal `'shopify'` | `tracking_source` |

If state was `qc_passed` or `shipped` AND `order_shipped` template never sent, fire it now.

---

## Sample payload 4 — `fulfillments/update`

Same shape. Look at `shipment_status`:
- `delivered` → transition state to `delivered`, stamp `delivered_at`.
- Anything else → no state change, log to status history if useful.

---

## HMAC verification

`lib/shopify/verify-webhook.ts`:

```typescript
import crypto from "node:crypto";

export function verifyShopifyWebhook(
  rawBody: string | Buffer,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader) return false;

  const computed = crypto
    .createHmac("sha256", secret)
    .update(typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody)
    .digest("base64");

  const a = Buffer.from(computed, "utf8");
  const b = Buffer.from(signatureHeader, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
```

Route handler (`app/api/webhooks/shopify/orders/route.ts`):

```typescript
import { NextRequest, NextResponse } from "next/server";
import { verifyShopifyWebhook } from "@/lib/shopify/verify-webhook";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const raw = await req.text();   // RAW string — DO NOT use req.json()
  const sig = req.headers.get("x-shopify-hmac-sha256");
  const topic = req.headers.get("x-shopify-topic");
  const webhookId = req.headers.get("x-shopify-webhook-id");

  if (!verifyShopifyWebhook(raw, sig, process.env.SHOPIFY_WEBHOOK_SECRET!)) {
    return new NextResponse("invalid signature", { status: 401 });
  }

  // Idempotency: unique constraint on shopify_webhook_events.webhook_id
  const event = await tryInsertWebhookEvent({
    topic,
    webhookId,
    rawBody: JSON.parse(raw),
  });
  if (!event) return NextResponse.json({ ok: true, duplicate: true });

  // Dispatch based on topic
  // ...

  return NextResponse.json({ ok: true });
}
```

**Critical:** `req.text()` first, then `JSON.parse()`. Using `req.json()` re-orders keys and breaks HMAC intermittently. #1 webhook bug.

---

## Local test script

`scripts/test-webhook.sh`:

```bash
#!/usr/bin/env bash
set -e

SECRET="${SHOPIFY_WEBHOOK_SECRET:-test_secret_change_me}"
URL="${WEBHOOK_URL:-http://localhost:3000/api/webhooks/shopify/orders}"
PAYLOAD_FILE="${1:-samples/order_create_multi.json}"
TOPIC="${2:-orders/create}"

if [ ! -f "$PAYLOAD_FILE" ]; then
  echo "payload file not found: $PAYLOAD_FILE"
  exit 1
fi

HMAC=$(openssl dgst -sha256 -hmac "$SECRET" -binary < "$PAYLOAD_FILE" | openssl base64 -A)

echo "POST $PAYLOAD_FILE → $URL"
echo "Topic: $TOPIC"

curl -v -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Topic: $TOPIC" \
  -H "X-Shopify-Hmac-Sha256: $HMAC" \
  -H "X-Shopify-Shop-Domain: sblossom.myshopify.com" \
  -H "X-Shopify-Webhook-Id: test-$(date +%s)" \
  -H "X-Shopify-Order-Id: 5847291938273" \
  --data-binary "@$PAYLOAD_FILE"

echo ""
```

Usage:
```bash
chmod +x scripts/test-webhook.sh
./scripts/test-webhook.sh samples/order_create_multi.json orders/create

WEBHOOK_URL=http://localhost:3000/api/webhooks/shopify/fulfillments \
  ./scripts/test-webhook.sh samples/fulfillment_create.json fulfillments/create
```

---

## ngrok for real Shopify → local

```bash
pnpm dev                          # 1. Start Next.js
ngrok http 3000                   # 2. Expose, copy the https URL

# 3. In Shopify admin → Settings → Notifications → Webhooks → Create
#    Event: Order creation
#    Format: JSON
#    URL: https://abc123.ngrok-free.app/api/webhooks/shopify/orders
#    Webhook API version: 2024-10 (or latest)
#    Save → copy the signing secret it shows ONCE → put in .env.local
```

Create a draft order, tag it `under production`, watch local logs.

---

## Webhooks to register in Shopify (only these 3)

1. **Order creation** → `/api/webhooks/shopify/orders`
2. **Order updated** → `/api/webhooks/shopify/orders` (same endpoint)
3. **Fulfillment creation** + **Fulfillment update** → `/api/webhooks/shopify/fulfillments`

Anything else (orders/paid, orders/cancelled, customers/*, etc.) is YAGNI for Phase 1.

---

## Tag-sync write path (separate from webhooks)

When a tag is added/removed in our app, we PUT to Shopify:

```http
PUT https://sblossom.myshopify.com/admin/api/2024-10/orders/{shopify_order_id}.json
X-Shopify-Access-Token: {SHOPIFY_ADMIN_ACCESS_TOKEN}
Content-Type: application/json

{
  "order": {
    "id": 5847291938273,
    "tags": "under production, priority, air-shipping"
  }
}
```

Tags in Shopify are a single comma-separated string. Always send the FULL desired set, not a delta — Shopify replaces, doesn't merge.

The subsequent `orders/updated` webhook will echo back. To prevent loops:
- Track outgoing tag writes with a timestamp in `orders.last_tag_push_at`.
- On incoming webhook, if `updated_at` is within 30 s of `last_tag_push_at`, skip the sync.
