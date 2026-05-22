# Interakt WhatsApp Template Submissions — Sblossom Ops (v2)

Submit these at **app.interakt.ai → Notifications → Templates → Create New Template**.

## WhatsApp rules to avoid rejection

1. **Variables are sequential numbered placeholders**: `{{1}}`, `{{2}}`, `{{3}}`. Skip a number → rejected.
2. **Body cannot start or end with a variable.** Plain text required at both ends.
3. **No consecutive variables.** Text between `{{1}}` and `{{2}}` required.
4. **No promotional language in UTILITY templates.** Avoid "offer", "discount", "sale", "deal".
5. **Sample values must be plausible.** No `asdf` / `test`.
6. **Authentication templates have a fixed shape.** Follow exactly.
7. **Approval lead time:** 1-24 hours typically. Submit all 8 in one sitting today.

---

## Template 1: `order_in_production` (prepaid)

| Field | Value |
|---|---|
| Name | `order_in_production` |
| Category | **UTILITY** |
| Language | English |

**Body:**
```
Hi {{1}}, your Sblossom order #{{2}} is now in production.

Items: {{3}}
Personalization: {{4}}
Special instructions: {{5}}
Payment mode: {{6}}

We'll notify you at every step. Track anytime at track.sblossom.com.

Team Sblossom
```

**Samples:**
- `{{1}}` → `Priya`
- `{{2}}` → `1042`
- `{{3}}` → `2 x Wooden Name Plate`
- `{{4}}` → `Sharma Family, The Patels`
- `{{5}}` → `Cursive font for both`
- `{{6}}` → `Prepaid`

**Buttons:** URL `Track Order` → `https://track.sblossom.com`

---

## Template 2: `order_in_production_cod`

| Field | Value |
|---|---|
| Name | `order_in_production_cod` |
| Category | **UTILITY** |
| Language | English |

**Body:**
```
Hi {{1}}, your Sblossom order #{{2}} is now in production.

Items: {{3}}
Personalization: {{4}}
Special instructions: {{5}}
Payment mode: Cash on Delivery
COD amount to be paid: Rs. {{6}}

We'll notify you at every step. Track anytime at track.sblossom.com.

Team Sblossom
```

**Samples:**
- `{{1}}` → `Priya`
- `{{2}}` → `1042`
- `{{3}}` → `2 x Wooden Name Plate`
- `{{4}}` → `Sharma Family, The Patels`
- `{{5}}` → `Cursive font for both`
- `{{6}}` → `2598`

**Buttons:** URL `Track Order` → `https://track.sblossom.com`

> Two templates because WhatsApp doesn't allow conditional content. Code picks the right one based on payment mode.

---

## Template 3: `qc_passed`

| Field | Value |
|---|---|
| Name | `qc_passed` |
| Category | **UTILITY** |
| Language | English |

**Body:**
```
Hi {{1}}, great news — your order #{{2}} has passed quality check and is being packed for shipment. You'll get a tracking link shortly.

Team Sblossom
```

**Samples:** `{{1}}` → `Priya`, `{{2}}` → `1042`

**Buttons:** URL `Track Order` → `https://track.sblossom.com`

---

## Template 4: `qc_failed_remaking`

> Sent only ONCE per order regardless of how many items fail across rounds.

| Field | Value |
|---|---|
| Name | `qc_failed_remaking` |
| Category | **UTILITY** |
| Language | English |

**Body:**
```
Hi {{1}}, we spotted a small issue in quality check for your order #{{2}}, so our team is remaking the affected item to ensure it meets Sblossom standards.

Your order is back in production. We'll share the new shipment date soon.

Thank you for your patience.

Team Sblossom
```

**Samples:** `{{1}}` → `Priya`, `{{2}}` → `1042`

**Buttons:** URL `Track Order` → `https://track.sblossom.com`

---

## Template 5: `order_shipped`

| Field | Value |
|---|---|
| Name | `order_shipped` |
| Category | **UTILITY** |
| Language | English |

**Body:**
```
Hi {{1}}, your Sblossom order #{{2}} has been shipped via {{3}}.

Tracking ID: {{4}}

You can track your shipment using the link below.

Team Sblossom
```

**Samples:** `{{1}}` → `Priya`, `{{2}}` → `1042`, `{{3}}` → `Delhivery`, `{{4}}` → `7891234567`

**Buttons:** URL (dynamic) `Track Shipment` → `https://{{5}}` (sample: `delhivery.com/track/package/7891234567`)

---

## Template 6: `mockup_updated`

> Sent only when a PSD is replaced AND reason = customer requested change AND employee opts in.

| Field | Value |
|---|---|
| Name | `mockup_updated` |
| Category | **UTILITY** |
| Language | English |

**Body:**
```
Hi {{1}}, the design for your Sblossom order #{{2}} has been updated as per your request. We're now making the new version. You'll be notified once it's ready.

Team Sblossom
```

**Samples:** `{{1}}` → `Priya`, `{{2}}` → `1042`

**Buttons:** URL `Track Order` → `https://track.sblossom.com`

---

## Template 7: `qc_status_updated`

> Sent only when admin changes QC status post-grace (rare).

| Field | Value |
|---|---|
| Name | `qc_status_updated` |
| Category | **UTILITY** |
| Language | English |

**Body:**
```
Hi {{1}}, we wanted to update you on your Sblossom order #{{2}}. There's been a change in its status. Please check track.sblossom.com or reply here for details.

Team Sblossom
```

**Samples:** `{{1}}` → `Priya`, `{{2}}` → `1042`

**Buttons:** URL `Track Order` → `https://track.sblossom.com`

---

## Template 8: `tracking_otp`

> AUTHENTICATION category. Follow Meta's mandated shape exactly.

| Field | Value |
|---|---|
| Name | `tracking_otp` |
| Category | **AUTHENTICATION** |
| Language | English |

**Body:**
```
{{1}} is your verification code. For your security, do not share this code.
```

**Samples:** `{{1}}` → `482910`

**Settings:**
- Expiration time: **10 minutes**
- Enable "add security recommendation"
- Enable **Copy code** button (Meta auto-generates the action)

---

## Optional: `daily_summary` (Template 9)

If you want the Phase 4 daily summary feature:

| Field | Value |
|---|---|
| Name | `daily_summary` |
| Category | **UTILITY** |
| Language | English |

**Body:**
```
Sblossom Daily — {{1}}

In Production: {{2}} ({{3}} QC redo)
Awaiting QC: {{4}}
Awaiting Shipment: {{5}}
Stuck more than 3 days: {{6}}
Open call requests: {{7}}

Yesterday: {{8}} shipped, {{9}} entered production
QC pass rate (7d): {{10}}

Team Sblossom
```

**Samples:** `{{1}}` → `22 May 2026`, `{{2}}` → `23`, `{{3}}` → `4`, `{{4}}` → `8`, `{{5}}` → `12`, `{{6}}` → `2`, `{{7}}` → `1`, `{{8}}` → `18`, `{{9}}` → `22`, `{{10}}` → `87 percent`

> Submit only if you want this feature ready for Phase 4 launch. Can be added later.

---

## Submission order

1. ☐ `order_in_production`
2. ☐ `order_in_production_cod`
3. ☐ `qc_passed`
4. ☐ `qc_failed_remaking`
5. ☐ `order_shipped`
6. ☐ `mockup_updated`
7. ☐ `qc_status_updated`
8. ☐ `tracking_otp`
9. ☐ `daily_summary` (optional)

Wait for green dots next to each. If rejected, check the rejection reason — usually a variable placement issue or a word triggering marketing classification. Fix and resubmit.

---

## API payload reference (for Claude Code building `lib/interakt/templates.ts`)

```http
POST https://api.interakt.ai/v1/public/message/
Authorization: Basic <base64(API_KEY:)>
Content-Type: application/json

{
  "countryCode": "+91",
  "phoneNumber": "9876543210",
  "type": "Template",
  "callbackData": "order_1042_in_production",
  "template": {
    "name": "order_in_production",
    "languageCode": "en",
    "bodyValues": [
      "Priya",
      "1042",
      "2 x Wooden Name Plate",
      "Sharma Family, The Patels",
      "Cursive font for both",
      "Prepaid"
    ]
  }
}
```

`phoneNumber` excludes country code and any leading `0`. `bodyValues` maps to `{{1}}`, `{{2}}`... in order.
