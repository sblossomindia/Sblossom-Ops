'use server';

import { and, eq, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { auth } from '@/auth';
import {
  buildOrderInProduction,
  buildOrderInProductionCod,
  TEMPLATE_KEYS,
} from '@/lib/interakt/templates';
import { sendNotification } from '@/lib/interakt/send';
import { db } from '@/lib/db';
import { orderItems, orders } from '@/lib/db/schema';
import { transitionOrder } from '@/lib/state-machine';

const itemSchema = z.object({
  orderItemId: z.string().uuid(),
  mockupSourceKey: z.string().min(1),
  mockupThumbnailKey: z.string().min(1),
  namesText: z.string().min(1, 'Names required'),
  customizationNotes: z.string().max(2000).optional().nullable(),
});

const payloadSchema = z
  .object({
    orderId: z.string().uuid(),
    paymentMode: z.enum(['prepaid', 'cod']),
    codAmount: z.string().optional(),
    items: z.array(itemSchema).min(1),
  })
  .superRefine((data, ctx) => {
    if (data.paymentMode === 'cod') {
      const amount = data.codAmount ? parseFloat(data.codAmount) : NaN;
      if (!Number.isFinite(amount) || amount <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['codAmount'],
          message: 'COD amount must be a positive number',
        });
      }
    }
  });

export type SubmitPayload = z.infer<typeof payloadSchema>;
export type SubmitResult = { ok: true; orderId: string } | { ok: false; error: string };

/**
 * Tab 1 submit. Validates → persists item data + order fields → transitions
 * to `in_production` via the state machine → fires order_in_production
 * (or _cod variant) WhatsApp. All in this order so notifications never fire
 * for a half-persisted order.
 */
export async function submitOrderForProduction(payload: SubmitPayload): Promise<SubmitResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'Not signed in.' };
  if (session.user.role !== 'production' && session.user.role !== 'admin') {
    return { ok: false, error: 'Only production / admin can submit Tab 1.' };
  }

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid form data.' };
  }
  const data = parsed.data;

  // Load order and items together to enforce ownership + state precondition
  // before any writes.
  const [order] = await db.select().from(orders).where(eq(orders.id, data.orderId)).limit(1);
  if (!order) return { ok: false, error: 'Order not found.' };
  if (order.deletedAt) return { ok: false, error: 'Order is deleted.' };
  if (order.state !== 'approval_pending') {
    return {
      ok: false,
      error: `Order is in state ${order.state}, not approval_pending. Was it already submitted?`,
    };
  }

  const itemIds = data.items.map((i) => i.orderItemId);
  const dbItems = await db
    .select()
    .from(orderItems)
    .where(and(eq(orderItems.orderId, data.orderId), inArray(orderItems.id, itemIds)));
  if (dbItems.length !== itemIds.length) {
    return { ok: false, error: 'Some line items not found or belong to a different order.' };
  }
  // Also require the payload covers EVERY item — partial submits are a bug.
  const allItemsForOrder = await db
    .select({ id: orderItems.id })
    .from(orderItems)
    .where(eq(orderItems.orderId, data.orderId));
  if (allItemsForOrder.length !== data.items.length) {
    return { ok: false, error: 'Payload must include every line item.' };
  }

  // Atomic persist: per-item updates + order fields. NOT including the state
  // transition — state machine has its own tx + history insert.
  await db.transaction(async (tx) => {
    for (const item of data.items) {
      await tx
        .update(orderItems)
        .set({
          mockupSourceUrl: item.mockupSourceKey,
          mockupThumbnailUrl: item.mockupThumbnailKey,
          mockupUploadedAt: new Date(),
          namesText: item.namesText,
          customizationNotes: item.customizationNotes ?? null,
          updatedAt: new Date(),
        })
        .where(eq(orderItems.id, item.orderItemId));
    }
    await tx
      .update(orders)
      .set({
        paymentMode: data.paymentMode,
        codAmount: data.paymentMode === 'cod' ? (data.codAmount ?? null) : null,
        tab1CompletedAt: new Date(),
        tab1CompletedBy: session.user.id,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, data.orderId));
  });

  // State transition (separate tx).
  try {
    await transitionOrder(data.orderId, 'in_production', session.user.id, {
      reason: 'tab1_submit',
      metadata: { paymentMode: data.paymentMode, itemCount: data.items.length },
    });
  } catch (err) {
    return {
      ok: false,
      error: `Could not transition state: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Build the WhatsApp template payload. Combine item titles, names, notes
  // into the (single-line) template variables per interakt_templates.md.
  const itemsByDbId = new Map(dbItems.map((i) => [i.id, i]));
  const itemsSummary = data.items
    .map((i) => {
      const dbItem = itemsByDbId.get(i.orderItemId);
      const qty = dbItem?.quantity ?? 1;
      return `${qty} x ${dbItem?.title ?? 'item'}`;
    })
    .join(', ');
  const personalization = data.items.map((i) => i.namesText).join('; ');
  const specialInstructions =
    data.items
      .map((i) => i.customizationNotes?.trim())
      .filter((s): s is string => !!s)
      .join('; ') || '—';

  const callbackData = `tab1_${data.orderId}`;
  const templatePayload =
    data.paymentMode === 'cod'
      ? buildOrderInProductionCod(
          order.customerPhone,
          {
            customerName: order.customerName,
            orderNumber: order.shopifyOrderNumber,
            itemsSummary,
            personalization,
            specialInstructions,
            codAmount: data.codAmount ?? order.totalAmount ?? '0',
          },
          callbackData,
        )
      : buildOrderInProduction(
          order.customerPhone,
          {
            customerName: order.customerName,
            orderNumber: order.shopifyOrderNumber,
            itemsSummary,
            personalization,
            specialInstructions,
          },
          callbackData,
        );

  try {
    await sendNotification({
      orderId: data.orderId,
      recipientPhone: order.customerPhone,
      templateKey:
        data.paymentMode === 'cod'
          ? TEMPLATE_KEYS.orderInProductionCod
          : TEMPLATE_KEYS.orderInProduction,
      payload: templatePayload,
    });
  } catch (err) {
    // State transition succeeded, but notification failed. Don't roll back —
    // the order is logically in production. Surface a warning; admin can
    // re-fire from /admin/notifications later (Phase 4.6).
    console.error(`Tab 1 notification failed for order ${data.orderId}:`, err);
  }

  revalidatePath('/orders/new');
  return { ok: true, orderId: data.orderId };
}
