/**
 * Order state machine.
 *
 * The single entry point for any code that changes `orders.state`. Wraps the
 * UPDATE + `order_status_history` INSERT in a transaction so they're always
 * consistent (CLAUDE.md hard rule 1).
 *
 * Helpers that span QC + notifications also live here so the "what state are
 * we in?" question has one home.
 *
 * Splitting work between in-transaction and post-commit (CLAUDE.md rule 5):
 *   - DB mutations + the notifications_log row insert happen INSIDE a tx.
 *     This makes the dedup gate (qc_failed_remaking once-per-order) atomic
 *     against concurrent QC actions.
 *   - The actual Interakt HTTP call happens AFTER the tx commits, via
 *     `dispatchById` on the just-inserted row.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  notificationsLog,
  orderItems,
  orderStatusHistory,
  orders,
  type Order,
} from '@/lib/db/schema';
import { dispatchById } from '@/lib/interakt/send';
import { buildQcFailedRemaking, buildQcPassed, TEMPLATE_KEYS } from '@/lib/interakt/templates';

import {
  IllegalTransitionError,
  isLegalTransition,
  type OrderState,
} from './transitions';

export * from './transitions';

const GRACE_DURATION_MS = 60 * 60 * 1000; // 1 hour (CLAUDE.md hard rule 15)

/* ── transitionOrder ────────────────────────────────────────────────────── */

export interface TransitionOpts {
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface TransitionResult {
  from: OrderState;
  to: OrderState;
}

/**
 * Move an order to a new state. Locks the order row, validates the
 * transition, updates `orders.state`, writes `order_status_history` — all in
 * one transaction. Returns the from/to states.
 *
 * Pass `actorUserId = null` for system-triggered transitions (cron, webhook).
 */
export async function transitionOrder(
  orderId: string,
  toState: OrderState,
  actorUserId: string | null,
  opts: TransitionOpts = {},
): Promise<TransitionResult> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ state: orders.state })
      .from(orders)
      .where(eq(orders.id, orderId))
      .for('update');

    if (!current) throw new IllegalTransitionError(null, toState, `order ${orderId} not found`);
    const fromState = current.state;

    if (fromState === toState) {
      throw new IllegalTransitionError(fromState, toState, 'already in this state');
    }
    if (!isLegalTransition(fromState, toState)) {
      throw new IllegalTransitionError(fromState, toState);
    }

    // Transition-specific side effects on the orders row.
    const updates: Partial<typeof orders.$inferInsert> = {
      state: toState,
      updatedAt: new Date(),
    };
    if (toState === 'qc_passed') {
      // Grace tracking is consumed by the qc_passed transition.
      updates.qcGraceStartedAt = null;
      updates.qcGraceNotificationId = null;
    }

    await tx.update(orders).set(updates).where(eq(orders.id, orderId));

    await tx.insert(orderStatusHistory).values({
      orderId,
      fromState,
      toState,
      actorUserId,
      reason: opts.reason ?? null,
      metadata: (opts.metadata ?? null) as object | null,
    });

    return { from: fromState, to: toState };
  });
}

/* ── QC orchestration ───────────────────────────────────────────────────── */

export type TryAdvanceDecision =
  | { kind: 'grace_started'; notificationId: string; scheduledFor: Date }
  | { kind: 'grace_reset'; notificationId: string; scheduledFor: Date }
  | { kind: 'failed_queued'; notificationId: string }
  | { kind: 'failed_already_queued' }
  | { kind: 'incomplete' }
  | { kind: 'no_items' };

/**
 * Re-evaluate an order's QC state after any item's `qc_status` changes.
 *
 *   all items passed     → start (or reset) the 1h grace timer
 *   any item failed      → queue qc_failed_remaking (once per order)
 *                           and cancel any grace timer
 *   some items pending   → cancel any grace timer (we're no longer
 *                           heading toward qc_passed), do nothing else
 *
 * Returns a decision describing what happened. Callers (Tab 3) can surface
 * the grace banner / redo badge from this.
 */
export async function tryAdvanceFromItemQc(
  orderId: string,
  actorUserId: string | null,
): Promise<TryAdvanceDecision> {
  let toDispatch: string | null = null;

  const decision = await db.transaction(async (tx): Promise<TryAdvanceDecision> => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .for('update');
    if (!order) throw new Error(`order ${orderId} not found`);

    const items = await tx
      .select({ qcStatus: orderItems.qcStatus })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));

    if (items.length === 0) return { kind: 'no_items' };

    const allPassed = items.every((i) => i.qcStatus === 'passed');
    const anyFailed = items.some((i) => i.qcStatus === 'failed');

    if (allPassed) {
      const graceActive = !!order.qcGraceNotificationId;
      if (graceActive) await cancelScheduledRow(tx, order.qcGraceNotificationId!);
      const { notificationId, scheduledFor } = await scheduleGraceRow(tx, order);
      return graceActive
        ? { kind: 'grace_reset', notificationId, scheduledFor }
        : { kind: 'grace_started', notificationId, scheduledFor };
    }

    // Not all passed — any active grace is no longer valid.
    if (order.qcGraceNotificationId) {
      await cancelScheduledRow(tx, order.qcGraceNotificationId);
      await tx
        .update(orders)
        .set({ qcGraceStartedAt: null, qcGraceNotificationId: null })
        .where(eq(orders.id, orderId));
    }

    if (anyFailed) {
      // Dedup: has qc_failed_remaking been queued/sent for this order before?
      // The same-tx read sees rows another concurrent tx already inserted
      // because we hold the row lock on `orders`.
      const [prior] = await tx
        .select({ id: notificationsLog.id })
        .from(notificationsLog)
        .where(
          and(
            eq(notificationsLog.orderId, orderId),
            eq(notificationsLog.templateKey, TEMPLATE_KEYS.qcFailedRemaking),
            inArray(notificationsLog.status, ['queued', 'scheduled', 'sent']),
          ),
        )
        .limit(1);

      if (prior) return { kind: 'failed_already_queued' };

      const payload = buildQcFailedRemaking(
        order.customerPhone,
        { customerName: order.customerName, orderNumber: order.shopifyOrderNumber },
        `qc_failed_remaking_${orderId}`,
      );

      const [row] = await tx
        .insert(notificationsLog)
        .values({
          orderId,
          channel: 'whatsapp',
          templateKey: TEMPLATE_KEYS.qcFailedRemaking,
          recipientPhone: order.customerPhone,
          payload,
          status: 'queued',
        })
        .returning({ id: notificationsLog.id });

      if (!row) throw new Error('failed to insert qc_failed_remaking notification row');
      toDispatch = row.id;
      return { kind: 'failed_queued', notificationId: row.id };
    }

    return { kind: 'incomplete' };
  });

  // Post-commit dispatch (CLAUDE.md hard rule 5).
  if (toDispatch) {
    try {
      await dispatchById(toDispatch);
    } catch (err) {
      console.error(`dispatch of ${toDispatch} failed:`, err);
      // The row is already 'queued' in DB; dispatchById marks 'failed' on
      // its own error path. If it threw, leave it queued for manual retry.
    }
  }
  return decision;
}

/* ── Grace timer helpers ────────────────────────────────────────────────── */

export interface GraceTimerResult {
  notificationId: string;
  scheduledFor: Date;
}

/**
 * Explicit "schedule grace" entry point — used when callers want to start
 * the timer without re-running the items-aggregate logic in
 * tryAdvanceFromItemQc (e.g., admin "send qc_passed now" button later).
 * Throws if grace is already active for this order.
 */
export async function scheduleQcPassedNotification(
  orderId: string,
): Promise<GraceTimerResult> {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .for('update');
    if (!order) throw new Error(`order ${orderId} not found`);
    if (order.qcGraceNotificationId) {
      throw new Error(`grace already active for order ${orderId}`);
    }
    return scheduleGraceRow(tx, order);
  });
}

/** Cancel any active grace timer + schedule a fresh one. */
export async function resetGraceTimer(orderId: string): Promise<GraceTimerResult> {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .for('update');
    if (!order) throw new Error(`order ${orderId} not found`);
    if (order.qcGraceNotificationId) {
      await cancelScheduledRow(tx, order.qcGraceNotificationId);
    }
    return scheduleGraceRow(tx, order);
  });
}

/** Cancel any active grace timer; leave the order without one. */
export async function cancelGraceTimer(orderId: string): Promise<void> {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .for('update');
    if (!order) throw new Error(`order ${orderId} not found`);
    if (order.qcGraceNotificationId) {
      await cancelScheduledRow(tx, order.qcGraceNotificationId);
    }
    await tx
      .update(orders)
      .set({ qcGraceStartedAt: null, qcGraceNotificationId: null })
      .where(eq(orders.id, orderId));
  });
}

/* ── Cron entrypoint ────────────────────────────────────────────────────── */

export interface ProcessScheduledResult {
  claimed: number;
  succeeded: number;
  failed: number;
}

/**
 * Drain the scheduled-notifications queue. Atomically claims due rows by
 * flipping their status `scheduled` → `queued` (FOR UPDATE SKIP LOCKED), then
 * processes each one. For `qc_passed` rows, advances the order state in the
 * same transaction; for everything else, just dispatches.
 *
 * Designed to be safe to run concurrently — the row-level lock means two
 * cron workers can't claim the same row.
 */
export async function processScheduledNotifications(): Promise<ProcessScheduledResult> {
  const claimed = (await db.execute(sql`
    UPDATE notifications_log
    SET status = 'queued'
    WHERE id IN (
      SELECT id FROM notifications_log
      WHERE status = 'scheduled' AND scheduled_for <= now()
      FOR UPDATE SKIP LOCKED
      LIMIT 50
    )
    RETURNING id
  `)) as Array<{ id: string }>;

  let succeeded = 0;
  let failed = 0;

  for (const { id } of claimed) {
    try {
      await processOneClaimed(id);
      succeeded += 1;
    } catch (err) {
      failed += 1;
      console.error(`processScheduledNotifications: ${id} failed`, err);
      // Mark the notification failed so it isn't retried as queued forever.
      await db
        .update(notificationsLog)
        .set({
          status: 'failed',
          errorMessage: err instanceof Error ? err.message : String(err),
        })
        .where(eq(notificationsLog.id, id));
    }
  }

  return { claimed: claimed.length, succeeded, failed };
}

async function processOneClaimed(notificationId: string): Promise<void> {
  // For qc_passed: transition order state in its own tx, alongside clearing
  // grace tracking. Idempotent: if the order is somehow not in_production
  // anymore, throw — outer loop marks the notification failed.
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        orderId: notificationsLog.orderId,
        templateKey: notificationsLog.templateKey,
        status: notificationsLog.status,
      })
      .from(notificationsLog)
      .where(eq(notificationsLog.id, notificationId))
      .limit(1);
    if (!row) throw new Error(`notification ${notificationId} not found`);
    if (row.status !== 'queued') {
      throw new Error(`notification ${notificationId} not queued (got ${row.status})`);
    }

    if (row.templateKey === TEMPLATE_KEYS.qcPassed && row.orderId) {
      const [order] = await tx
        .select({ state: orders.state })
        .from(orders)
        .where(eq(orders.id, row.orderId))
        .for('update');
      if (!order) throw new Error(`order ${row.orderId} not found`);
      if (!isLegalTransition(order.state, 'qc_passed')) {
        throw new IllegalTransitionError(
          order.state,
          'qc_passed',
          'order moved unexpectedly during grace',
        );
      }
      await tx
        .update(orders)
        .set({
          state: 'qc_passed',
          qcGraceStartedAt: null,
          qcGraceNotificationId: null,
          updatedAt: new Date(),
        })
        .where(eq(orders.id, row.orderId));
      await tx.insert(orderStatusHistory).values({
        orderId: row.orderId,
        fromState: order.state,
        toState: 'qc_passed',
        actorUserId: null,
        reason: 'qc_grace_elapsed',
        metadata: { notificationId } as object,
      });
    }
  });

  // Post-commit dispatch.
  await dispatchById(notificationId);
}

/* ── Internal helpers (in-transaction) ──────────────────────────────────── */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function scheduleGraceRow(tx: Tx, order: Order): Promise<GraceTimerResult> {
  const scheduledFor = new Date(Date.now() + GRACE_DURATION_MS);
  const payload = buildQcPassed(
    order.customerPhone,
    { customerName: order.customerName, orderNumber: order.shopifyOrderNumber },
    `qc_passed_${order.id}`,
  );

  const [row] = await tx
    .insert(notificationsLog)
    .values({
      orderId: order.id,
      channel: 'whatsapp',
      templateKey: TEMPLATE_KEYS.qcPassed,
      recipientPhone: order.customerPhone,
      payload,
      status: 'scheduled',
      scheduledFor,
    })
    .returning({ id: notificationsLog.id });
  if (!row) throw new Error('failed to insert scheduled qc_passed row');

  await tx
    .update(orders)
    .set({ qcGraceStartedAt: new Date(), qcGraceNotificationId: row.id })
    .where(eq(orders.id, order.id));

  return { notificationId: row.id, scheduledFor };
}

async function cancelScheduledRow(tx: Tx, notificationId: string): Promise<void> {
  await tx
    .update(notificationsLog)
    .set({ status: 'cancelled' })
    .where(
      and(
        eq(notificationsLog.id, notificationId),
        eq(notificationsLog.status, 'scheduled'),
      ),
    );
}

