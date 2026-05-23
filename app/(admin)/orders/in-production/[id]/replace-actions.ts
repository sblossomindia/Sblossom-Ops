'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { auth } from '@/auth';
import { db } from '@/lib/db';
import { mockupHistory, orderItems, orders } from '@/lib/db/schema';
import { sendNotification } from '@/lib/interakt/send';
import { buildMockupUpdated, TEMPLATE_KEYS } from '@/lib/interakt/templates';

const REASONS = [
  'customer_requested_change',
  'design_error',
  'file_corruption',
  'other',
] as const;

const schema = z
  .object({
    orderItemId: z.string().uuid(),
    newSourceKey: z.string().nullable(),
    newThumbnailKey: z.string().nullable(),
    reason: z.enum(REASONS),
    notes: z.string().max(2000).optional(),
    notifyCustomer: z.boolean().default(false),
  })
  .refine((d) => !!d.newSourceKey || !!d.newThumbnailKey, {
    message: 'Upload at least one of PSD or thumbnail',
  });

export type ReplaceMockupResult = { ok: true } | { ok: false; error: string };

/**
 * Replace a line item's mockup files. Pre-QC only — the server gates on
 * `order.state === 'in_production'`. Writes a `mockup_history` audit row
 * inside the same transaction as the order_items UPDATE so the previous
 * URLs are never lost.
 *
 * If reason = customer_requested_change AND the PSD was replaced AND the
 * caller asked for notification, queues the `mockup_updated` WhatsApp
 * template after the transaction commits (CLAUDE.md hard rule 5).
 */
export async function replaceMockupAction(
  input: z.infer<typeof schema>,
): Promise<ReplaceMockupResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'Not signed in' };
  if (session.user.role !== 'production' && session.user.role !== 'admin') {
    return { ok: false, error: 'Only production / admin can replace mockups' };
  }

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  const data = parsed.data;

  // Load item + parent order in one query so we have the state, customer
  // info, and prior URLs all at once.
  const [row] = await db
    .select({
      itemId: orderItems.id,
      orderId: orderItems.orderId,
      prevSource: orderItems.mockupSourceUrl,
      prevThumb: orderItems.mockupThumbnailUrl,
      replacedCount: orderItems.mockupReplacedCount,
      orderState: orders.state,
      orderDeletedAt: orders.deletedAt,
      customerName: orders.customerName,
      customerPhone: orders.customerPhone,
      shopifyOrderNumber: orders.shopifyOrderNumber,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(eq(orderItems.id, data.orderItemId))
    .limit(1);

  if (!row) return { ok: false, error: 'Order item not found' };
  if (row.orderDeletedAt) return { ok: false, error: 'Order is deleted' };
  if (row.orderState !== 'in_production') {
    return {
      ok: false,
      error: `Replace allowed only in_production (order is ${row.orderState})`,
    };
  }

  const sourceReplaced = !!data.newSourceKey;
  const thumbnailReplaced = !!data.newThumbnailKey;
  const customerRequested = data.reason === 'customer_requested_change';
  const willNotify = data.notifyCustomer && sourceReplaced && customerRequested;

  // Atomic apply: audit row + item update in one tx.
  await db.transaction(async (tx) => {
    await tx.insert(mockupHistory).values({
      orderItemId: data.orderItemId,
      previousSourceUrl: row.prevSource,
      previousThumbnailUrl: row.prevThumb,
      sourceReplaced,
      thumbnailReplaced,
      reason: data.reason,
      notes: data.notes?.trim() ? data.notes.trim() : null,
      notifiedCustomer: willNotify,
      replacedBy: session.user.id,
    });

    const updates: Partial<typeof orderItems.$inferInsert> = {
      mockupUploadedAt: new Date(),
      mockupReplacedCount: row.replacedCount + 1,
      updatedAt: new Date(),
    };
    if (sourceReplaced) updates.mockupSourceUrl = data.newSourceKey;
    if (thumbnailReplaced) updates.mockupThumbnailUrl = data.newThumbnailKey;
    await tx.update(orderItems).set(updates).where(eq(orderItems.id, data.orderItemId));
  });

  // Post-commit notification (rule 5).
  if (willNotify) {
    try {
      const payload = buildMockupUpdated(
        row.customerPhone,
        { customerName: row.customerName, orderNumber: row.shopifyOrderNumber },
        `mockup_updated_${row.orderId}_${Date.now()}`,
      );
      await sendNotification({
        orderId: row.orderId,
        recipientPhone: row.customerPhone,
        templateKey: TEMPLATE_KEYS.mockupUpdated,
        payload,
      });
    } catch (err) {
      // Don't fail the replace — mockup is committed. Admin can refire later.
      console.error('mockup_updated send failed:', err);
    }
  }

  revalidatePath(`/orders/in-production/${row.orderId}`);
  return { ok: true };
}
