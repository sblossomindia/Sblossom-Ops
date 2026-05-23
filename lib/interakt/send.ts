/**
 * Notification send + scheduling, wired around `notifications_log`.
 *
 * CLAUDE.md hard rule 5: write the row first (status `queued` or `scheduled`),
 * commit, *then* dispatch the Interakt call. Never call Interakt from inside
 * a caller's transaction — long network call + DB lock = bad time.
 *
 * `sendNotification` is the synchronous-dispatch path. `scheduleNotification`
 * just enqueues a row to be processed later by the cron in task 2.4.
 *
 * `qc_failed_remaking` is "once per order" per CLAUDE.md hard rule 16 — see
 * `hasTemplateBeenSentForOrder` and use it in the caller (state machine,
 * task 1.9) before calling sendNotification.
 */
import { and, eq, inArray } from 'drizzle-orm';

import { db } from '@/lib/db';
import { notificationsLog } from '@/lib/db/schema';

import { callInterakt, type InteraktPayload, type InteraktResult } from './client';

export interface SendOptions {
  orderId: string | null;
  recipientPhone: string; // E.164, already normalized
  templateKey: string;
  payload: InteraktPayload;
}

export interface SendResult {
  notificationId: string;
  ok: boolean;
  interakt: InteraktResult;
}

/**
 * Insert a `queued` log row, commit, dispatch, then update with the result.
 * The commit between insert and dispatch is intentional — if Interakt is
 * slow or the process crashes mid-call, the log row survives as a `queued`
 * orphan that a future janitor (or admin) can reconcile.
 */
export async function sendNotification(opts: SendOptions): Promise<SendResult> {
  const [row] = await db
    .insert(notificationsLog)
    .values({
      orderId: opts.orderId,
      channel: 'whatsapp',
      templateKey: opts.templateKey,
      recipientPhone: opts.recipientPhone,
      payload: opts.payload,
      status: 'queued',
    })
    .returning({ id: notificationsLog.id });

  if (!row) throw new Error('Failed to insert notifications_log row');

  const result = await callInterakt(opts.payload);

  await db
    .update(notificationsLog)
    .set({
      status: result.ok ? 'sent' : 'failed',
      response: (result.response ?? null) as object | null,
      sentAt: result.ok ? new Date() : null,
      errorMessage: result.ok ? null : result.error,
    })
    .where(eq(notificationsLog.id, row.id));

  return { notificationId: row.id, ok: result.ok, interakt: result };
}

/**
 * Insert a `scheduled` row to be processed by the per-minute cron (2.4).
 * Does NOT dispatch — caller relies on the cron to advance state.
 */
export interface ScheduleOptions extends SendOptions {
  scheduledFor: Date;
}

export async function scheduleNotification(
  opts: ScheduleOptions,
): Promise<{ notificationId: string }> {
  const [row] = await db
    .insert(notificationsLog)
    .values({
      orderId: opts.orderId,
      channel: 'whatsapp',
      templateKey: opts.templateKey,
      recipientPhone: opts.recipientPhone,
      payload: opts.payload,
      status: 'scheduled',
      scheduledFor: opts.scheduledFor,
    })
    .returning({ id: notificationsLog.id });

  if (!row) throw new Error('Failed to insert scheduled notifications_log row');
  return { notificationId: row.id };
}

/**
 * Cancel a previously scheduled notification. Used when the QC grace timer
 * resets (task 2.2) — delete the old scheduled row and insert a fresh one.
 * Returns the count of rows transitioned.
 */
export async function cancelScheduledNotification(notificationId: string): Promise<number> {
  const result = await db
    .update(notificationsLog)
    .set({ status: 'cancelled' })
    .where(
      and(eq(notificationsLog.id, notificationId), eq(notificationsLog.status, 'scheduled')),
    )
    .returning({ id: notificationsLog.id });
  return result.length;
}

/**
 * Check if a given template has already been sent (or scheduled) for an
 * order. Use this before queueing `qc_failed_remaking` (CLAUDE.md hard rule
 * 16: at most once per order).
 */
export async function hasTemplateBeenSentForOrder(
  orderId: string,
  templateKey: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: notificationsLog.id })
    .from(notificationsLog)
    .where(
      and(
        eq(notificationsLog.orderId, orderId),
        eq(notificationsLog.templateKey, templateKey),
        inArray(notificationsLog.status, ['queued', 'scheduled', 'sent']),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
