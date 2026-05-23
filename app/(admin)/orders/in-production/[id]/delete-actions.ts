'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { auth } from '@/auth';
import { db } from '@/lib/db';
import { orders } from '@/lib/db/schema';

const schema = z.object({
  orderId: z.string().uuid(),
});

/**
 * Soft-delete an order. Pre-QC only — once QC has run, the order is committed
 * (customer's expecting it) and admin can't take it back from this UI. After
 * 30 days the cleanup cron (task 4.8) hard-purges the row.
 *
 * Doesn't touch Shopify — the source-of-truth order stays. We just stop
 * showing the order in our ops tabs.
 */
const PRE_QC_STATES = ['approval_pending', 'in_production'] as const;
type PreQcState = (typeof PRE_QC_STATES)[number];

export type DeleteOrderResult = { ok: true } | { ok: false; error: string };

export async function softDeleteOrderAction(
  input: z.infer<typeof schema>,
): Promise<DeleteOrderResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'Not signed in' };
  if (session.user.role !== 'admin') {
    return { ok: false, error: 'Admin only' };
  }

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid input' };

  const [order] = await db
    .select({ id: orders.id, state: orders.state, deletedAt: orders.deletedAt })
    .from(orders)
    .where(eq(orders.id, parsed.data.orderId))
    .limit(1);

  if (!order) return { ok: false, error: 'Order not found' };
  if (order.deletedAt) return { ok: false, error: 'Order is already deleted' };
  if (!(PRE_QC_STATES as readonly string[]).includes(order.state)) {
    return {
      ok: false,
      error: `Delete is pre-QC only (order is in state ${order.state})`,
    };
  }
  // narrow for clarity; the check above is the real gate
  void (order.state as PreQcState);

  await db
    .update(orders)
    .set({
      deletedAt: new Date(),
      deletedBy: session.user.id,
      updatedAt: new Date(),
    })
    .where(eq(orders.id, parsed.data.orderId));

  // Both lists could show this order pre-delete; refresh both.
  revalidatePath('/orders/new');
  revalidatePath('/orders/in-production');
  return { ok: true };
}
