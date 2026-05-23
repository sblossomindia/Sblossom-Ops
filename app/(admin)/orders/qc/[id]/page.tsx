/**
 * Tab 3 detail — per-order QC review. Placeholder until task 2.2 builds the
 * mobile-first item-by-item QC flow. Keeping the route alive so the list
 * cards don't navigate to a 404.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { orders } from '@/lib/db/schema';

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
      state: orders.state,
      deletedAt: orders.deletedAt,
    })
    .from(orders)
    .where(eq(orders.id, id))
    .limit(1);

  if (!order || order.deletedAt) notFound();

  return (
    <main className="container max-w-xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-primary sm:text-2xl">{order.shopifyOrderName}</h1>
        <Link href="/orders/qc" className="text-sm text-muted-foreground underline">
          ← Back
        </Link>
      </header>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">QC review</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Per-item QC flow lands in task 2.2. This order is in state{' '}
          <span className="font-mono">{order.state}</span>.
        </CardContent>
      </Card>
    </main>
  );
}
