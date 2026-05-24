'use server';

import { and, eq, inArray, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { auth } from '@/auth';
import { db } from '@/lib/db';
import { orderItems, orders } from '@/lib/db/schema';
import { tryAdvanceFromItemQc, type TryAdvanceDecision } from '@/lib/state-machine';

const itemSchema = z
  .object({
    orderItemId: z.string().uuid(),
    qcStatus: z.enum(['passed', 'failed']),
    qcPhotoKey: z.string().nullable(),
    qcFailureReason: z.string().max(2000).nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.qcStatus === 'passed' && !data.qcPhotoKey) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Pass requires a photo', path: ['qcPhotoKey'] });
    }
    if (data.qcStatus === 'failed') {
      const reason = data.qcFailureReason?.trim() ?? '';
      if (reason.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Fail requires a reason',
          path: ['qcFailureReason'],
        });
      }
    }
  });

const submitSchema = z.object({
  orderId: z.string().uuid(),
  items: z.array(itemSchema).min(1),
});

export type SubmitQcResult =
  | { ok: true; message: string; decision: TryAdvanceDecision }
  | { ok: false; error: string };

/**
 * Submit QC for every line item in one order, then hand off to the state
 * machine to schedule the grace timer / queue qc_failed_remaking.
 *
 * Order-level constraints:
 *   - State must be `in_production` (qc_passed orders have a separate edit
 *     path through admin reopen — task 2.5)
 *   - Payload must include EVERY line item (no partial submits — the action
 *     bar in the UI enforces this client-side too)
 */
export async function submitQcAction(
  input: z.infer<typeof submitSchema>,
): Promise<SubmitQcResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'Not signed in' };
  if (session.user.role !== 'qc' && session.user.role !== 'admin') {
    return { ok: false, error: 'Only QC / admin can submit QC' };
  }

  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  const data = parsed.data;

  const [order] = await db
    .select({
      id: orders.id,
      state: orders.state,
      deletedAt: orders.deletedAt,
      qcAttempts: orders.qcAttempts,
    })
    .from(orders)
    .where(eq(orders.id, data.orderId))
    .limit(1);
  if (!order) return { ok: false, error: 'Order not found' };
  if (order.deletedAt) return { ok: false, error: 'Order is deleted' };
  if (order.state !== 'in_production') {
    return {
      ok: false,
      error: `QC only allowed in_production (order is ${order.state})`,
    };
  }

  // Verify every line item in the order is covered.
  const itemIds = data.items.map((i) => i.orderItemId);
  const dbItems = await db
    .select({ id: orderItems.id })
    .from(orderItems)
    .where(and(eq(orderItems.orderId, data.orderId), inArray(orderItems.id, itemIds)));
  if (dbItems.length !== itemIds.length) {
    return { ok: false, error: 'Some items not found or belong to a different order' };
  }
  const allItems = await db
    .select({ id: orderItems.id })
    .from(orderItems)
    .where(eq(orderItems.orderId, data.orderId));
  if (allItems.length !== data.items.length) {
    return { ok: false, error: 'Payload must cover every line item' };
  }

  // Atomic per-item update + order-level counters.
  await db.transaction(async (tx) => {
    for (const item of data.items) {
      await tx
        .update(orderItems)
        .set({
          qcStatus: item.qcStatus,
          qcPhotoUrl: item.qcPhotoKey,
          qcFailureReason:
            item.qcStatus === 'failed' ? (item.qcFailureReason?.trim() ?? null) : null,
          qcAt: new Date(),
          qcBy: session.user.id,
          qcAttempts: sql`${orderItems.qcAttempts} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(orderItems.id, item.orderItemId));
    }
    await tx
      .update(orders)
      .set({
        lastQcAt: new Date(),
        qcAttempts: order.qcAttempts + 1,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, data.orderId));
  });

  // Hand off to the state machine (its own tx + post-commit dispatch).
  const decision = await tryAdvanceFromItemQc(data.orderId, session.user.id);

  revalidatePath('/orders/qc');
  revalidatePath(`/orders/qc/${data.orderId}`);
  revalidatePath('/orders/in-production');

  return { ok: true, message: messageFor(decision), decision };
}

function messageFor(decision: TryAdvanceDecision): string {
  switch (decision.kind) {
    case 'grace_started':
      return 'All items passed — grace timer running (1 h)';
    case 'grace_reset':
      return 'All items passed — grace timer reset';
    case 'failed_queued':
      return 'Items failed — remake WhatsApp queued';
    case 'failed_already_queued':
      return 'Items failed — remake notification was already sent for this order';
    case 'incomplete':
      return 'QC saved (some items still pending)';
    case 'no_items':
      return 'QC saved (no items)';
  }
}
