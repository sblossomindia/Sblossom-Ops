/**
 * Tab 2 — In Production list. Read-only view of orders the production team
 * is actively working on (state in_production or qc_passed).
 *
 * Sort: oldest entry-into-production first, so the team works the queue
 * head-on. Uses `tab1_completed_at` (when Tab 1 was submitted) and falls
 * back to `created_at` for any rows missing that stamp.
 */
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { orderItems, orderTags, orders } from '@/lib/db/schema';
import { relativeTime } from '@/lib/format';

interface TagInfo {
  name: string;
  isCustomerVisible: boolean;
}

export default async function InProductionListPage() {
  await requireRole('production', 'qc', 'admin');

  const rows = await db
    .select({
      id: orders.id,
      shopifyOrderName: orders.shopifyOrderName,
      customerName: orders.customerName,
      state: orders.state,
      tab1CompletedAt: orders.tab1CompletedAt,
      createdAt: orders.createdAt,
      itemCount: sql<number>`count(distinct ${orderItems.id})::int`,
      tags: sql<TagInfo[]>`coalesce(
        jsonb_agg(distinct jsonb_build_object(
          'name', ${orderTags.tagName},
          'isCustomerVisible', ${orderTags.isCustomerVisible}
        )) filter (where ${orderTags.tagName} is not null),
        '[]'::jsonb
      )`,
    })
    .from(orders)
    .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
    .leftJoin(orderTags, eq(orderTags.orderId, orders.id))
    .where(
      and(
        inArray(orders.state, ['in_production', 'qc_passed']),
        isNull(orders.deletedAt),
      ),
    )
    .groupBy(orders.id)
    .orderBy(asc(sql`coalesce(${orders.tab1CompletedAt}, ${orders.createdAt})`));

  return (
    <main className="container max-w-5xl py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">Tab 2 — In Production</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length === 0
              ? 'No orders currently in production.'
              : `${rows.length} order${rows.length === 1 ? '' : 's'} in flight, oldest first.`}
          </p>
        </div>
        <Link href="/" className="text-sm text-muted-foreground underline hover:text-foreground">
          ← Dashboard
        </Link>
      </header>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Orders show up here once Tab 1 submission moves them to{' '}
            <code>in_production</code>.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                href={`/orders/in-production/${row.id}`}
                className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Card className="transition-colors hover:bg-accent/40">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center justify-between gap-3 text-base">
                      <span className="truncate">{row.shopifyOrderName}</span>
                      <div className="flex shrink-0 items-center gap-2">
                        {/* WHERE clause constrains state, but TS can't see that. */}
                        <StateBadge state={row.state as 'in_production' | 'qc_passed'} />
                        <Badge variant="secondary">
                          {row.itemCount} item{row.itemCount === 1 ? '' : 's'}
                        </Badge>
                      </div>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-[1fr_1fr_auto] sm:gap-x-6">
                    <div>
                      <div className="text-muted-foreground">Customer</div>
                      <div className="font-medium">{row.customerName}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">In production</div>
                      <div>{relativeTime(row.tab1CompletedAt ?? row.createdAt)}</div>
                    </div>
                    <div className="sm:text-right">
                      <div className="mb-1 text-muted-foreground">Tags</div>
                      {row.tags.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1 sm:justify-end">
                          {row.tags.map((tag) => (
                            <TagChip key={tag.name} tag={tag} />
                          ))}
                        </div>
                      )}
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

function StateBadge({ state }: { state: 'in_production' | 'qc_passed' }) {
  if (state === 'qc_passed') {
    return (
      <Badge variant="secondary" className="bg-primary/15 text-primary">
        QC Passed
      </Badge>
    );
  }
  return <Badge variant="outline">In Production</Badge>;
}

function TagChip({ tag }: { tag: TagInfo }) {
  return tag.isCustomerVisible ? (
    <Badge variant="secondary" className="bg-secondary text-secondary-foreground">
      {tag.name}
    </Badge>
  ) : (
    <Badge
      variant="outline"
      className="border-muted-foreground/30 text-muted-foreground"
      title="Internal-only tag"
    >
      {tag.name}
    </Badge>
  );
}
