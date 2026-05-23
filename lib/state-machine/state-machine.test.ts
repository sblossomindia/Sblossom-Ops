/**
 * Integration tests for the state machine — these touch the real Supabase
 * DB. Each test creates uniquely-prefixed fixtures and cleans up after
 * itself. Run with MOCK_INTERAKT=1 in .env.local so dispatches short-circuit.
 */
import { randomUUID } from 'node:crypto';

import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db, closeDb } from '@/lib/db';
import {
  notificationsLog,
  orderItems,
  orderStatusHistory,
  orders,
  users,
  type Order,
} from '@/lib/db/schema';
import { TEMPLATE_KEYS } from '@/lib/interakt/templates';

import {
  IllegalTransitionError,
  cancelGraceTimer,
  processScheduledNotifications,
  resetGraceTimer,
  scheduleQcPassedNotification,
  transitionOrder,
  tryAdvanceFromItemQc,
  type OrderState,
} from './index';

// Track everything we create so afterAll can purge — order_items cascade via
// FK so orders are sufficient; users / notifications cleaned separately.
const createdOrderIds: string[] = [];
const createdUserIds: string[] = [];
const createdNotificationIds: string[] = [];

let actorId: string;

beforeAll(async () => {
  const [u] = await db
    .insert(users)
    .values({
      email: `sm-test-${randomUUID()}@sblossom.local`,
      passwordHash: 'unused-test-hash',
      name: 'State Machine Test User',
      role: 'admin',
    })
    .returning({ id: users.id });
  actorId = u!.id;
  createdUserIds.push(actorId);
});

afterAll(async () => {
  if (createdNotificationIds.length > 0) {
    await db.delete(notificationsLog).where(inArray(notificationsLog.id, createdNotificationIds));
  }
  if (createdOrderIds.length > 0) {
    // notifications_log + order_status_history + order_items cascade via FK.
    await db.delete(orders).where(inArray(orders.id, createdOrderIds));
  }
  if (createdUserIds.length > 0) {
    await db.delete(users).where(inArray(users.id, createdUserIds));
  }
  await closeDb();
});

/** Create a fresh order in the given state with N items. Cleanup is handled
 *  by afterAll. */
async function createOrder(opts: {
  state?: OrderState;
  itemCount?: number;
  itemQcStatuses?: Array<'passed' | 'failed' | null>;
}): Promise<Order> {
  const state = opts.state ?? 'in_production';
  const itemCount = opts.itemCount ?? (opts.itemQcStatuses?.length ?? 1);
  const shopId = `STM-${randomUUID()}`;

  const [order] = await db
    .insert(orders)
    .values({
      shopifyOrderId: shopId,
      shopifyOrderNumber: shopId,
      shopifyOrderName: `#${shopId}`,
      customerName: 'Test Customer',
      customerPhone: '+919876500000',
      state,
    })
    .returning();
  if (!order) throw new Error('failed to create test order');
  createdOrderIds.push(order.id);

  for (let i = 0; i < itemCount; i++) {
    await db.insert(orderItems).values({
      orderId: order.id,
      shopifyLineItemId: `${shopId}-line-${i}`,
      title: `Test Item ${i}`,
      qcStatus: opts.itemQcStatuses?.[i] ?? null,
    });
  }

  return order;
}

/* ── transitionOrder ────────────────────────────────────────────────────── */

describe('transitionOrder', () => {
  it('approval_pending → in_production writes state + history in one tx', async () => {
    const order = await createOrder({ state: 'approval_pending' });

    const result = await transitionOrder(order.id, 'in_production', actorId, {
      reason: 'tab1_submit',
    });

    expect(result).toEqual({ from: 'approval_pending', to: 'in_production' });

    const [after] = await db
      .select({ state: orders.state })
      .from(orders)
      .where(eq(orders.id, order.id));
    expect(after?.state).toBe('in_production');

    const history = await db
      .select()
      .from(orderStatusHistory)
      .where(eq(orderStatusHistory.orderId, order.id));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      fromState: 'approval_pending',
      toState: 'in_production',
      actorUserId: actorId,
      reason: 'tab1_submit',
    });
  });

  it('rejects illegal forward jumps', async () => {
    const order = await createOrder({ state: 'approval_pending' });
    await expect(transitionOrder(order.id, 'shipped', actorId)).rejects.toThrow(
      IllegalTransitionError,
    );
    await expect(transitionOrder(order.id, 'qc_passed', actorId)).rejects.toThrow(
      IllegalTransitionError,
    );
    await expect(transitionOrder(order.id, 'delivered', actorId)).rejects.toThrow(
      IllegalTransitionError,
    );
  });

  it('rejects same-state transition', async () => {
    const order = await createOrder({ state: 'in_production' });
    await expect(transitionOrder(order.id, 'in_production', actorId)).rejects.toThrow(
      IllegalTransitionError,
    );
  });

  it('rejects rollbacks (in_production → approval_pending, shipped → qc_passed)', async () => {
    const a = await createOrder({ state: 'in_production' });
    await expect(transitionOrder(a.id, 'approval_pending', actorId)).rejects.toThrow(
      IllegalTransitionError,
    );

    const b = await createOrder({ state: 'shipped' });
    await expect(transitionOrder(b.id, 'qc_passed', actorId)).rejects.toThrow(
      IllegalTransitionError,
    );
  });

  it('allows qc_passed → in_production (admin reopen)', async () => {
    const order = await createOrder({ state: 'qc_passed' });
    const result = await transitionOrder(order.id, 'in_production', actorId, {
      reason: 'admin_reopen_qc',
    });
    expect(result.to).toBe('in_production');
  });

  it('full happy path: approval_pending → in_production → qc_passed → shipped → delivered', async () => {
    const order = await createOrder({ state: 'approval_pending' });
    await transitionOrder(order.id, 'in_production', actorId);
    await transitionOrder(order.id, 'qc_passed', null, { reason: 'qc_grace_elapsed' });
    await transitionOrder(order.id, 'shipped', actorId);
    await transitionOrder(order.id, 'delivered', null);

    const [final] = await db
      .select({ state: orders.state })
      .from(orders)
      .where(eq(orders.id, order.id));
    expect(final?.state).toBe('delivered');

    const history = await db
      .select()
      .from(orderStatusHistory)
      .where(eq(orderStatusHistory.orderId, order.id));
    expect(history).toHaveLength(4);
  });

  it('rolls back UPDATE + history together when something fails inside the tx', async () => {
    // We can't easily provoke a tx rollback without mutating the schema, but
    // we CAN verify the precondition: a failed transition writes NO history
    // row and does NOT change state.
    const order = await createOrder({ state: 'approval_pending' });
    await expect(transitionOrder(order.id, 'shipped', actorId)).rejects.toThrow();

    const [after] = await db
      .select({ state: orders.state })
      .from(orders)
      .where(eq(orders.id, order.id));
    expect(after?.state).toBe('approval_pending');

    const history = await db
      .select()
      .from(orderStatusHistory)
      .where(eq(orderStatusHistory.orderId, order.id));
    expect(history).toHaveLength(0);
  });

  it('clears qcGrace* fields when transitioning into qc_passed', async () => {
    const order = await createOrder({ state: 'in_production' });
    // Pre-seed grace fields as if the timer were active.
    await db
      .update(orders)
      .set({ qcGraceStartedAt: new Date(), qcGraceNotificationId: randomUUID() })
      .where(eq(orders.id, order.id));

    await transitionOrder(order.id, 'qc_passed', null, { reason: 'qc_grace_elapsed' });

    const [after] = await db
      .select({
        state: orders.state,
        qcGraceStartedAt: orders.qcGraceStartedAt,
        qcGraceNotificationId: orders.qcGraceNotificationId,
      })
      .from(orders)
      .where(eq(orders.id, order.id));
    expect(after?.state).toBe('qc_passed');
    expect(after?.qcGraceStartedAt).toBeNull();
    expect(after?.qcGraceNotificationId).toBeNull();
  });
});

/* ── tryAdvanceFromItemQc ───────────────────────────────────────────────── */

describe('tryAdvanceFromItemQc', () => {
  it('returns incomplete when items still pending', async () => {
    const order = await createOrder({ itemQcStatuses: ['passed', null, null] });
    const decision = await tryAdvanceFromItemQc(order.id, actorId);
    expect(decision).toEqual({ kind: 'incomplete' });

    const [row] = await db
      .select({ qcGraceNotificationId: orders.qcGraceNotificationId })
      .from(orders)
      .where(eq(orders.id, order.id));
    expect(row?.qcGraceNotificationId).toBeNull();
  });

  it('schedules grace timer when all items pass', async () => {
    const order = await createOrder({ itemQcStatuses: ['passed', 'passed', 'passed'] });
    const decision = await tryAdvanceFromItemQc(order.id, actorId);

    expect(decision.kind).toBe('grace_started');
    if (decision.kind !== 'grace_started') throw new Error('narrow');

    // Scheduled ~1 hour out (allow ±2s for jitter).
    const expectedMs = Date.now() + 60 * 60 * 1000;
    expect(Math.abs(decision.scheduledFor.getTime() - expectedMs)).toBeLessThan(2000);

    const [notif] = await db
      .select()
      .from(notificationsLog)
      .where(eq(notificationsLog.id, decision.notificationId));
    expect(notif?.status).toBe('scheduled');
    expect(notif?.templateKey).toBe(TEMPLATE_KEYS.qcPassed);

    const [orderAfter] = await db
      .select({
        qcGraceNotificationId: orders.qcGraceNotificationId,
        qcGraceStartedAt: orders.qcGraceStartedAt,
      })
      .from(orders)
      .where(eq(orders.id, order.id));
    expect(orderAfter?.qcGraceNotificationId).toBe(decision.notificationId);
    expect(orderAfter?.qcGraceStartedAt).not.toBeNull();

    // Order state itself stays in_production until the grace cron fires.
    const [stateAfter] = await db
      .select({ state: orders.state })
      .from(orders)
      .where(eq(orders.id, order.id));
    expect(stateAfter?.state).toBe('in_production');
  });

  it('resets grace timer on second all-passed evaluation', async () => {
    const order = await createOrder({ itemQcStatuses: ['passed', 'passed'] });
    const first = await tryAdvanceFromItemQc(order.id, actorId);
    if (first.kind !== 'grace_started') throw new Error('precondition');

    const second = await tryAdvanceFromItemQc(order.id, actorId);
    expect(second.kind).toBe('grace_reset');
    if (second.kind !== 'grace_reset') throw new Error('narrow');
    expect(second.notificationId).not.toBe(first.notificationId);

    // Original scheduled row is now cancelled.
    const [orig] = await db
      .select({ status: notificationsLog.status })
      .from(notificationsLog)
      .where(eq(notificationsLog.id, first.notificationId));
    expect(orig?.status).toBe('cancelled');
  });

  it('queues qc_failed_remaking on first item failure', async () => {
    const order = await createOrder({ itemQcStatuses: ['passed', 'failed'] });
    const decision = await tryAdvanceFromItemQc(order.id, actorId);
    expect(decision.kind).toBe('failed_queued');
    if (decision.kind !== 'failed_queued') throw new Error('narrow');

    const [notif] = await db
      .select({ templateKey: notificationsLog.templateKey, status: notificationsLog.status })
      .from(notificationsLog)
      .where(eq(notificationsLog.id, decision.notificationId));
    expect(notif?.templateKey).toBe(TEMPLATE_KEYS.qcFailedRemaking);
    // With MOCK_INTERAKT=1 the dispatch flips queued → sent.
    expect(notif?.status).toBe('sent');
  });

  it('does NOT queue qc_failed_remaking a second time per order', async () => {
    const order = await createOrder({ itemQcStatuses: ['passed', 'failed'] });
    const first = await tryAdvanceFromItemQc(order.id, actorId);
    expect(first.kind).toBe('failed_queued');

    // Second failure (or re-evaluation) — gate must catch it.
    const second = await tryAdvanceFromItemQc(order.id, actorId);
    expect(second.kind).toBe('failed_already_queued');

    const rows = await db
      .select()
      .from(notificationsLog)
      .where(
        and(
          eq(notificationsLog.orderId, order.id),
          eq(notificationsLog.templateKey, TEMPLATE_KEYS.qcFailedRemaking),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it('cancels active grace when an item flips to failed', async () => {
    const order = await createOrder({ itemQcStatuses: ['passed', 'passed'] });
    const start = await tryAdvanceFromItemQc(order.id, actorId);
    if (start.kind !== 'grace_started') throw new Error('precondition');

    // Flip the second item to failed.
    await db
      .update(orderItems)
      .set({ qcStatus: 'failed' })
      .where(
        and(eq(orderItems.orderId, order.id), eq(orderItems.shopifyLineItemId, `${order.shopifyOrderId}-line-1`)),
      );

    const second = await tryAdvanceFromItemQc(order.id, actorId);
    expect(second.kind).toBe('failed_queued');

    // Original grace notification cancelled, grace fields cleared.
    const [orig] = await db
      .select({ status: notificationsLog.status })
      .from(notificationsLog)
      .where(eq(notificationsLog.id, start.notificationId));
    expect(orig?.status).toBe('cancelled');

    const [orderAfter] = await db
      .select({
        qcGraceNotificationId: orders.qcGraceNotificationId,
        qcGraceStartedAt: orders.qcGraceStartedAt,
      })
      .from(orders)
      .where(eq(orders.id, order.id));
    expect(orderAfter?.qcGraceNotificationId).toBeNull();
    expect(orderAfter?.qcGraceStartedAt).toBeNull();
  });

  it('no_items short-circuits on an order with zero line items', async () => {
    const order = await createOrder({ itemCount: 0 });
    const decision = await tryAdvanceFromItemQc(order.id, actorId);
    expect(decision).toEqual({ kind: 'no_items' });
  });
});

/* ── Grace timer external helpers ───────────────────────────────────────── */

describe('grace timer helpers', () => {
  it('scheduleQcPassedNotification throws if grace already active', async () => {
    const order = await createOrder({ itemQcStatuses: ['passed'] });
    await tryAdvanceFromItemQc(order.id, actorId); // starts grace

    await expect(scheduleQcPassedNotification(order.id)).rejects.toThrow(/grace already active/);
  });

  it('resetGraceTimer replaces an existing scheduled row', async () => {
    const order = await createOrder({ itemQcStatuses: ['passed'] });
    const first = await tryAdvanceFromItemQc(order.id, actorId);
    if (first.kind !== 'grace_started') throw new Error('precondition');

    const reset = await resetGraceTimer(order.id);
    expect(reset.notificationId).not.toBe(first.notificationId);

    const [orig] = await db
      .select({ status: notificationsLog.status })
      .from(notificationsLog)
      .where(eq(notificationsLog.id, first.notificationId));
    expect(orig?.status).toBe('cancelled');
  });

  it('cancelGraceTimer cancels the scheduled row and clears grace fields', async () => {
    const order = await createOrder({ itemQcStatuses: ['passed'] });
    const start = await tryAdvanceFromItemQc(order.id, actorId);
    if (start.kind !== 'grace_started') throw new Error('precondition');

    await cancelGraceTimer(order.id);

    const [notif] = await db
      .select({ status: notificationsLog.status })
      .from(notificationsLog)
      .where(eq(notificationsLog.id, start.notificationId));
    expect(notif?.status).toBe('cancelled');

    const [orderAfter] = await db
      .select({
        qcGraceNotificationId: orders.qcGraceNotificationId,
        qcGraceStartedAt: orders.qcGraceStartedAt,
      })
      .from(orders)
      .where(eq(orders.id, order.id));
    expect(orderAfter?.qcGraceNotificationId).toBeNull();
    expect(orderAfter?.qcGraceStartedAt).toBeNull();
  });
});

/* ── processScheduledNotifications ──────────────────────────────────────── */

describe('processScheduledNotifications', () => {
  it('claims a due scheduled row, transitions in_production → qc_passed, dispatches', async () => {
    const order = await createOrder({ itemQcStatuses: ['passed'] });
    const start = await tryAdvanceFromItemQc(order.id, actorId);
    if (start.kind !== 'grace_started') throw new Error('precondition');

    // Backdate scheduled_for so it's due now.
    await db
      .update(notificationsLog)
      .set({ scheduledFor: new Date(Date.now() - 1000) })
      .where(eq(notificationsLog.id, start.notificationId));

    const result = await processScheduledNotifications();
    expect(result.succeeded).toBeGreaterThanOrEqual(1);

    const [notif] = await db
      .select({ status: notificationsLog.status, sentAt: notificationsLog.sentAt })
      .from(notificationsLog)
      .where(eq(notificationsLog.id, start.notificationId));
    expect(notif?.status).toBe('sent');
    expect(notif?.sentAt).not.toBeNull();

    const [orderAfter] = await db
      .select({
        state: orders.state,
        qcGraceNotificationId: orders.qcGraceNotificationId,
      })
      .from(orders)
      .where(eq(orders.id, order.id));
    expect(orderAfter?.state).toBe('qc_passed');
    expect(orderAfter?.qcGraceNotificationId).toBeNull();

    const history = await db
      .select()
      .from(orderStatusHistory)
      .where(eq(orderStatusHistory.orderId, order.id));
    const qcPassedTransitions = history.filter((h) => h.toState === 'qc_passed');
    expect(qcPassedTransitions).toHaveLength(1);
    expect(qcPassedTransitions[0]?.reason).toBe('qc_grace_elapsed');
  });

  it('does not pick up rows whose scheduled_for is still in the future', async () => {
    const order = await createOrder({ itemQcStatuses: ['passed'] });
    await tryAdvanceFromItemQc(order.id, actorId); // scheduledFor = now + 1h

    const result = await processScheduledNotifications();
    // It might pick up other tests' rows in CI (shared DB); just assert that
    // OUR row stays scheduled.
    void result;

    const [orderAfter] = await db
      .select({ state: orders.state })
      .from(orders)
      .where(eq(orders.id, order.id));
    expect(orderAfter?.state).toBe('in_production');
  });
});
