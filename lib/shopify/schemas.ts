/**
 * Zod schemas for the subset of Shopify webhook payloads we care about.
 *
 * Why permissive: Shopify's REST webhook payloads are vast and they version
 * fields silently. We pick out fields we use and let unknown ones pass via
 * `.passthrough()` so a new Shopify field doesn't break ingestion.
 *
 * Type coercion notes:
 *   - IDs and order numbers come as `number` from Shopify; we cast to `string`
 *     so they match our `text` schema columns.
 *   - Prices come as decimal strings; we keep as strings (our `numeric` columns
 *     accept strings too).
 */
import { z } from 'zod';

const stringOrNumberToString = z.union([z.string(), z.number()]).transform((v) => String(v));

const lineItemSchema = z
  .object({
    id: stringOrNumberToString,
    title: z.string(),
    variant_title: z.string().nullable().optional(),
    sku: z.string().nullable().optional(),
    quantity: z.number().int().nonnegative(),
    price: z.string().nullable().optional(),
  })
  .passthrough();

const shippingAddressSchema = z
  .object({
    first_name: z.string().nullable().optional(),
    last_name: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    address1: z.string().nullable().optional(),
    address2: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    province: z.string().nullable().optional(),
    country: z.string().nullable().optional(),
    zip: z.string().nullable().optional(),
  })
  .passthrough();

const customerSchema = z
  .object({
    first_name: z.string().nullable().optional(),
    last_name: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
  })
  .passthrough();

export const orderWebhookSchema = z
  .object({
    id: stringOrNumberToString,
    order_number: stringOrNumberToString,
    name: z.string(),
    tags: z.string().optional().default(''),
    email: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    total_price: z.string().nullable().optional(),
    currency: z.string().nullable().optional(),
    financial_status: z.string().nullable().optional(),
    customer: customerSchema.nullable().optional(),
    shipping_address: shippingAddressSchema.nullable().optional(),
    line_items: z.array(lineItemSchema),
  })
  .passthrough();

export type OrderWebhookPayload = z.infer<typeof orderWebhookSchema>;

/**
 * Fulfillment webhooks include the parent order_id and tracking fields. We
 * don't ingest the full fulfillment object; just what's needed to update the
 * tracking columns on the existing order row.
 */
export const fulfillmentWebhookSchema = z
  .object({
    id: stringOrNumberToString,
    order_id: stringOrNumberToString,
    status: z.string().nullable().optional(),
    tracking_number: z.string().nullable().optional(),
    tracking_numbers: z.array(z.string()).optional(),
    tracking_url: z.string().nullable().optional(),
    tracking_urls: z.array(z.string()).optional(),
    tracking_company: z.string().nullable().optional(),
    shipment_status: z.string().nullable().optional(),
  })
  .passthrough();

export type FulfillmentWebhookPayload = z.infer<typeof fulfillmentWebhookSchema>;

/** Tag string → trimmed array. Empty string → []. */
export function parseShopifyTags(tags: string | null | undefined): string[] {
  if (!tags) return [];
  return tags
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

/** The exact trigger tag from CLAUDE.md (case-sensitive, single space). */
export const TRIGGER_TAG = 'under production';
