/**
 * Tab 1 detail — the full order form. Server component that loads the order
 * + line items and hands off to the client form.
 */
import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { orderItems, orders } from '@/lib/db/schema';

import { OrderForm } from './order-form';

export default async function TabOneDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole('production', 'admin');
  const { id } = await params;

  const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
  if (!order || order.deletedAt) notFound();

  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id))
    .orderBy(orderItems.shopifyLineItemId);

  // Defensive: if the order has advanced past Tab 1, render a "done" view
  // rather than the form. Browser back-button into a completed order is the
  // common way to land here.
  if (order.state !== 'approval_pending') {
    return (
      <main className="container max-w-3xl py-10">
        <header className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-primary">{order.shopifyOrderName}</h1>
          <Link href="/orders/new" className="text-sm text-muted-foreground underline">
            ← Back to list
          </Link>
        </header>
        <Card>
          <CardHeader>
            <CardTitle>Already submitted</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            This order is in state <span className="font-mono">{order.state}</span>. Tab 1 can
            only edit orders in <span className="font-mono">approval_pending</span>.
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="container max-w-3xl py-10">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">{order.shopifyOrderName}</h1>
          <p className="text-sm text-muted-foreground">
            {items.length} line item{items.length === 1 ? '' : 's'} · total{' '}
            {order.totalAmount ? `₹${order.totalAmount}` : '—'}
          </p>
        </div>
        <Link href="/orders/new" className="text-sm text-muted-foreground underline">
          ← Back to list
        </Link>
      </header>

      {/* Customer info */}
      <Card className="mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Customer</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div>
            <span className="text-muted-foreground">Name:</span>{' '}
            <span className="font-medium">{order.customerName}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Phone:</span>{' '}
            <span className="font-mono">{order.customerPhone}</span>
          </div>
          {order.customerEmail && (
            <div className="col-span-2">
              <span className="text-muted-foreground">Email:</span>{' '}
              <span>{order.customerEmail}</span>
            </div>
          )}
          {!!order.shippingAddress && typeof order.shippingAddress === 'object' ? (
            <div className="col-span-2">
              <span className="text-muted-foreground">Ship to:</span>{' '}
              <span>{formatAddress(order.shippingAddress as Record<string, unknown>)}</span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <OrderForm
        order={{
          id: order.id,
          shopifyOrderNumber: order.shopifyOrderNumber,
          totalAmount: order.totalAmount,
        }}
        items={items.map((i) => ({
          id: i.id,
          title: i.title,
          variantTitle: i.variantTitle,
          quantity: i.quantity,
        }))}
      />
    </main>
  );
}

function formatAddress(addr: Record<string, unknown>): string {
  const parts = [addr.address1, addr.address2, addr.city, addr.province, addr.zip, addr.country]
    .filter((v): v is string => typeof v === 'string' && v.length > 0);
  return parts.join(', ') || '—';
}
