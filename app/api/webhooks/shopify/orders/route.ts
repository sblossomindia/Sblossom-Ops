/**
 * Shopify order webhook handler — `orders/create` and `orders/updated`.
 *
 * Flow (per CLAUDE.md hard rules 6, 7):
 *   1. Read raw body via `req.text()` BEFORE parsing (HMAC needs raw bytes).
 *   2. Verify HMAC. Bad → 401.
 *   3. Insert into shopify_webhook_events with webhookId as unique key.
 *      Duplicate (already seen) → 200 immediately, don't reprocess.
 *   4. Parse + validate payload with Zod.
 *   5. Filter: only orders/{create,updated} with the trigger tag get ingested.
 *   6. Ingest. Stamp processed_at or error_message on the webhook event.
 *
 * Always returns 200 for accepted (even if we skipped) — Shopify retries on
 * non-2xx and we don't want spurious retries for known-skip cases.
 */
import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { shopifyWebhookEvents } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { ingestShopifyOrder } from '@/lib/shopify/ingest';
import { orderWebhookSchema } from '@/lib/shopify/schemas';
import { verifyShopifyHmac } from '@/lib/shopify/verify';

const HANDLED_TOPICS = new Set(['orders/create', 'orders/updated']);

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();

  const signature = req.headers.get('x-shopify-hmac-sha256');
  const ok = await verifyShopifyHmac(rawBody, signature, env.SHOPIFY_WEBHOOK_SECRET ?? '');
  if (!ok) {
    return Response.json({ error: 'invalid_hmac' }, { status: 401 });
  }

  const topic = req.headers.get('x-shopify-topic') ?? '';
  const webhookId = req.headers.get('x-shopify-webhook-id');
  const shopifyOrderId = req.headers.get('x-shopify-order-id');

  if (!webhookId) {
    return Response.json({ error: 'missing_webhook_id' }, { status: 400 });
  }

  // Idempotency: insert webhook event row. If we've seen this webhookId before,
  // skip the work and return 200 (Shopify retries on non-2xx).
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const insertResult = await db
    .insert(shopifyWebhookEvents)
    .values({
      topic,
      webhookId,
      shopifyOrderId,
      rawBody: parsedBody as object,
    })
    .onConflictDoNothing({ target: shopifyWebhookEvents.webhookId })
    .returning({ id: shopifyWebhookEvents.id });

  if (insertResult.length === 0) {
    return Response.json({ ok: true, deduped: true });
  }
  const eventId = insertResult[0]!.id;

  if (!HANDLED_TOPICS.has(topic)) {
    await markProcessed(eventId, { error: `unhandled_topic:${topic}` });
    return Response.json({ ok: true, ignored: 'unhandled_topic', topic });
  }

  const parsed = orderWebhookSchema.safeParse(parsedBody);
  if (!parsed.success) {
    await markProcessed(eventId, { error: `validation:${parsed.error.issues[0]?.message}` });
    return Response.json({ error: 'invalid_payload' }, { status: 400 });
  }

  try {
    const result = await ingestShopifyOrder(parsed.data);
    await markProcessed(eventId, {
      error: result.status === 'skipped' ? `skipped:${result.reason}` : null,
    });
    return Response.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markProcessed(eventId, { error: `ingest_failed:${message}` });
    // Re-throw so Shopify retries on infra errors (DB outage, etc.).
    throw err;
  }
}

async function markProcessed(
  eventId: string,
  opts: { error?: string | null },
): Promise<void> {
  await db
    .update(shopifyWebhookEvents)
    .set({
      processedAt: new Date(),
      errorMessage: opts.error ?? null,
    })
    .where(eq(shopifyWebhookEvents.id, eventId));
}
