/**
 * Shopify fulfillment webhook handler — `fulfillments/create` and
 * `fulfillments/update`.
 *
 * Updates the tracking columns on the existing order. Does NOT transition
 * state — that's the state machine's job (task 2.7). If we don't have the
 * parent order in our DB (it never had the trigger tag), silently ack 200.
 */
import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { shopifyWebhookEvents } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { applyFulfillmentTracking } from '@/lib/shopify/ingest';
import { fulfillmentWebhookSchema } from '@/lib/shopify/schemas';
import { verifyShopifyHmac } from '@/lib/shopify/verify';

const HANDLED_TOPICS = new Set(['fulfillments/create', 'fulfillments/update']);

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();

  const signature = req.headers.get('x-shopify-hmac-sha256');
  const ok = await verifyShopifyHmac(rawBody, signature, env.SHOPIFY_WEBHOOK_SECRET ?? '');
  if (!ok) return Response.json({ error: 'invalid_hmac' }, { status: 401 });

  const topic = req.headers.get('x-shopify-topic') ?? '';
  const webhookId = req.headers.get('x-shopify-webhook-id');
  if (!webhookId) return Response.json({ error: 'missing_webhook_id' }, { status: 400 });

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const insertResult = await db
    .insert(shopifyWebhookEvents)
    .values({ topic, webhookId, rawBody: parsedBody as object })
    .onConflictDoNothing({ target: shopifyWebhookEvents.webhookId })
    .returning({ id: shopifyWebhookEvents.id });

  if (insertResult.length === 0) return Response.json({ ok: true, deduped: true });
  const eventId = insertResult[0]!.id;

  if (!HANDLED_TOPICS.has(topic)) {
    await mark(eventId, `unhandled_topic:${topic}`);
    return Response.json({ ok: true, ignored: 'unhandled_topic', topic });
  }

  const parsed = fulfillmentWebhookSchema.safeParse(parsedBody);
  if (!parsed.success) {
    await mark(eventId, `validation:${parsed.error.issues[0]?.message}`);
    return Response.json({ error: 'invalid_payload' }, { status: 400 });
  }

  const f = parsed.data;
  const trackingNumber = f.tracking_number ?? f.tracking_numbers?.[0] ?? null;
  const trackingUrl = f.tracking_url ?? f.tracking_urls?.[0] ?? null;
  const trackingCarrier = f.tracking_company ?? null;

  try {
    const updated = await applyFulfillmentTracking(f.order_id, {
      trackingNumber,
      trackingUrl,
      trackingCarrier,
    });
    await mark(eventId, updated ? null : 'order_not_in_db');
    return Response.json({ ok: true, updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await mark(eventId, `update_failed:${message}`);
    throw err;
  }
}

async function mark(eventId: string, error: string | null) {
  await db
    .update(shopifyWebhookEvents)
    .set({ processedAt: new Date(), errorMessage: error })
    .where(eq(shopifyWebhookEvents.id, eventId));
}
