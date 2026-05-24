/**
 * Tab 3 detail — per-order QC review. Mobile-first form per spec §6 Tab 3.
 *
 * State preconditions:
 *   - Order must be in `in_production` to QC. `qc_passed` shows a "passed"
 *     notice (re-judge from admin reopen is task 2.5). Other states fall
 *     through to a generic notice.
 */
import { asc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { orderItems, orders } from '@/lib/db/schema';
import { getViewUrl } from '@/lib/storage/r2';

import { QcForm, type QcFormItem } from './qc-form';

export default async function QcDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole('qc', 'admin');
  const { id } = await params;

  const [order] = await db
    .select({
      id: orders.id,
      shopifyOrderName: orders.shopifyOrderName,
      customerName: orders.customerName,
      customerPhone: orders.customerPhone,
      state: orders.state,
      deletedAt: orders.deletedAt,
      qcGraceStartedAt: orders.qcGraceStartedAt,
      qcGraceNotificationId: orders.qcGraceNotificationId,
    })
    .from(orders)
    .where(eq(orders.id, id))
    .limit(1);

  if (!order || order.deletedAt) notFound();

  if (order.state !== 'in_production') {
    return (
      <main className="container max-w-xl px-4 py-6 sm:px-6 sm:py-10">
        <Header order={order} />
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-base">QC not available</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            This order is in state <span className="font-mono">{order.state}</span>. QC only
            runs while the order is <span className="font-mono">in_production</span>.
            {order.state === 'qc_passed' && (
              <p className="mt-2">
                Re-opening QC post-grace is an admin-only flow (task 2.5).
              </p>
            )}
          </CardContent>
        </Card>
      </main>
    );
  }

  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id))
    .orderBy(asc(orderItems.shopifyLineItemId));

  // Sign mockup thumbnails + existing QC photo URLs in parallel.
  const formItems: QcFormItem[] = await Promise.all(
    items.map(async (item) => ({
      id: item.id,
      title: item.title,
      variantTitle: item.variantTitle,
      quantity: item.quantity,
      mockupThumbnailViewUrl: item.mockupThumbnailUrl
        ? await getViewUrl(item.mockupThumbnailUrl)
        : null,
      existingQcPhotoKey: item.qcPhotoUrl ?? null,
      existingQcPhotoUrl: item.qcPhotoUrl ? await getViewUrl(item.qcPhotoUrl) : null,
      existingQcStatus: item.qcStatus,
      existingQcFailureReason: item.qcFailureReason,
    })),
  );

  return (
    <main className="container max-w-xl px-4 py-5 sm:px-6 sm:py-8">
      <Header order={order} />

      {order.qcGraceStartedAt && (
        <Card className="mt-3 border-primary/40 bg-primary/5">
          <CardContent className="py-3 text-sm">
            <span className="font-medium text-primary">Grace period running.</span>{' '}
            <span className="text-muted-foreground">
              All items passed earlier. Editing any item will reset the timer.
            </span>
          </CardContent>
        </Card>
      )}

      <div className="mt-4">
        <QcForm orderId={order.id} items={formItems} />
      </div>
    </main>
  );
}

function Header({
  order,
}: {
  order: { shopifyOrderName: string; customerName: string };
}) {
  return (
    <header className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-bold text-primary sm:text-2xl">
          {order.shopifyOrderName}
        </h1>
        <p className="truncate text-sm text-muted-foreground">{order.customerName}</p>
      </div>
      <Link
        href="/orders/qc"
        className="shrink-0 text-sm text-muted-foreground underline hover:text-foreground"
      >
        ← Back
      </Link>
    </header>
  );
}
