/**
 * Order ingestion from Shopify webhooks.
 *
 * Upsert semantics:
 *   - INSERT on first sight: fields from Shopify + state = 'approval_pending'.
 *   - UPDATE on subsequent sightings: only sync fields that Shopify owns
 *     (tags, customer info, address, totals). Workflow state (state, qc_*,
 *     shipment_*) is NEVER touched here — those advance through the state
 *     machine (task 1.9) based on internal actions.
 *
 * Line items: inserted on conflict-do-nothing so updates don't disturb already-
 * tracked items. Full diff/sync is task 4.10 (backfill / drift detection).
 */
import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { orders, orderItems } from '@/lib/db/schema';
import { normalizePhone, PhoneFormatError } from '@/lib/phone';
import { reconcileOrderTagsFromWebhook } from '@/lib/tags/sync';

import {
  parseShopifyTags,
  TRIGGER_TAG,
  type OrderWebhookPayload,
} from './schemas';

type IngestResult =
  | { status: 'ingested'; orderId: string; created: boolean }
  | { status: 'skipped'; reason: 'missing_trigger_tag' | 'no_phone' };

function buildCustomerName(payload: OrderWebhookPayload): string {
  const c = payload.customer;
  const s = payload.shipping_address;
  const fromCustomer = [c?.first_name, c?.last_name].filter(Boolean).join(' ').trim();
  if (fromCustomer) return fromCustomer;
  const fromAddr = [s?.first_name, s?.last_name].filter(Boolean).join(' ').trim();
  return fromAddr || 'Unknown';
}

function buildCustomerPhone(payload: OrderWebhookPayload): string | null {
  const candidates = [
    payload.customer?.phone,
    payload.shipping_address?.phone,
    payload.phone,
  ];
  for (const raw of candidates) {
    if (!raw) continue;
    try {
      return normalizePhone(raw);
    } catch (err) {
      if (err instanceof PhoneFormatError) continue;
      throw err;
    }
  }
  return null;
}

export async function ingestShopifyOrder(payload: OrderWebhookPayload): Promise<IngestResult> {
  const tags = parseShopifyTags(payload.tags);
  if (!tags.includes(TRIGGER_TAG)) {
    return { status: 'skipped', reason: 'missing_trigger_tag' };
  }

  const phone = buildCustomerPhone(payload);
  if (!phone) {
    // No phone at all — we can't notify the customer later. Hard skip; raise
    // visibility so an admin can fix the Shopify record.
    return { status: 'skipped', reason: 'no_phone' };
  }

  const customerName = buildCustomerName(payload);
  const customerEmail = payload.customer?.email ?? payload.email ?? null;

  // Fields Shopify always owns — these get synced on insert AND on update.
  // updatedAt only set in the conflict path; on insert, DB default handles it.
  const shopifyOwnedFields = {
    shopifyOrderNumber: payload.order_number,
    shopifyOrderName: payload.name,
    shopifyTags: tags,
    customerName,
    customerPhone: phone,
    customerEmail,
    shippingAddress: payload.shipping_address ?? null,
    totalAmount: payload.total_price ?? null,
    currency: payload.currency ?? 'INR',
  };

  // Probe first so we can return an accurate `created` flag. One extra cheap
  // query — webhooks are low volume.
  const [existing] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.shopifyOrderId, payload.id))
    .limit(1);
  const created = !existing;

  const [upserted] = await db
    .insert(orders)
    .values({
      shopifyOrderId: payload.id,
      ...shopifyOwnedFields,
      state: 'approval_pending',
    })
    .onConflictDoUpdate({
      target: orders.shopifyOrderId,
      set: { ...shopifyOwnedFields, updatedAt: new Date() },
    })
    .returning({ id: orders.id });

  if (!upserted) throw new Error('Order upsert returned no row');
  const orderId = upserted.id;

  // Insert line items. Existing items are kept untouched (mockups + QC may
  // already be attached); new items added; the unique constraint on
  // (order_id, shopify_line_item_id) prevents duplicates.
  if (payload.line_items.length > 0) {
    await db
      .insert(orderItems)
      .values(
        payload.line_items.map((li) => ({
          orderId,
          shopifyLineItemId: li.id,
          title: li.title,
          variantTitle: li.variant_title ?? null,
          sku: li.sku ?? null,
          quantity: li.quantity,
          unitPrice: li.price ?? null,
        })),
      )
      .onConflictDoNothing({
        target: [orderItems.orderId, orderItems.shopifyLineItemId],
      });
  }

  // Reconcile local order_tags rows against Shopify's tag set (pull direction).
  // We do this for both create + update because a new order may have tags
  // applied alongside the trigger tag.
  await reconcileOrderTagsFromWebhook(orderId, tags);

  return { status: 'ingested', orderId, created };
}

/**
 * Update tracking columns on an existing order from a fulfillment webhook.
 * Returns true if the order was found + updated, false if we have no record
 * of it (which is normal — fulfillment may fire for orders we never ingested
 * because they didn't have the trigger tag).
 *
 * Does NOT advance order state. State transitions go through the state
 * machine (task 1.9 / 2.7).
 */
export async function applyFulfillmentTracking(
  shopifyOrderId: string,
  patch: {
    trackingNumber?: string | null;
    trackingUrl?: string | null;
    trackingCarrier?: string | null;
  },
): Promise<boolean> {
  const [existing] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.shopifyOrderId, shopifyOrderId))
    .limit(1);

  if (!existing) return false;

  await db
    .update(orders)
    .set({
      ...patch,
      trackingSource: 'shopify',
      updatedAt: new Date(),
    })
    .where(eq(orders.id, existing.id));

  return true;
}
