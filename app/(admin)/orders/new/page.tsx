/**
 * Tab 1 list — orders that need approval before production starts.
 *
 * Source: `approval_pending` orders, not soft-deleted, newest first.
 */
import { and, desc, eq, isNull } from 'drizzle-orm';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { orderItems, orders } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';
import { relativeTime } from '@/lib/format';

export default async function TabOneListPage() {
  await requireRole('production', 'admin');

  // Fetch orders + an item count via a left-join + group-by aggregation. Two
  // round-trips would be simpler but the join avoids an N+1.
  const rows = await db
    .select({
      id: orders.id,
      shopifyOrderNumber: orders.shopifyOrderNumber,
      shopifyOrderName: orders.shopifyOrderName,
      customerName: orders.customerName,
      customerPhone: orders.customerPhone,
      totalAmount: orders.totalAmount,
      currency: orders.currency,
      createdAt: orders.createdAt,
      itemCount: sql<number>`count(${orderItems.id})::int`,
    })
    .from(orders)
    .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
    .where(and(eq(orders.state, 'approval_pending'), isNull(orders.deletedAt)))
    .groupBy(orders.id)
    .orderBy(desc(orders.createdAt));

  return (
    <main className="container max-w-4xl py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">Tab 1 — Order Create</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length === 0
              ? 'No orders awaiting approval.'
              : `${rows.length} order${rows.length === 1 ? '' : 's'} awaiting approval.`}
          </p>
        </div>
        <Link href="/" className="text-sm text-muted-foreground underline hover:text-foreground">
          ← Dashboard
        </Link>
      </header>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            New orders arrive here once Shopify webhooks tag them <code>under production</code>.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                href={`/orders/new/${row.id}`}
                className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Card className="transition-colors hover:bg-accent/40">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center justify-between text-base">
                      <span>{row.shopifyOrderName}</span>
                      <Badge variant="secondary">
                        {row.itemCount} item{row.itemCount === 1 ? '' : 's'}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                    <div>
                      <div className="text-muted-foreground">Customer</div>
                      <div className="font-medium">{row.customerName}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Phone</div>
                      <div className="font-mono text-xs">{row.customerPhone}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Total</div>
                      <div>
                        {row.totalAmount
                          ? `${row.currency === 'INR' ? '₹' : ''}${row.totalAmount}`
                          : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Arrived</div>
                      <div>{relativeTime(row.createdAt)}</div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

