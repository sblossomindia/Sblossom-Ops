/**
 * Tab 3 — QC list (mobile-first). Cards are stacked single-column, full-width
 * tap targets ≥ 44px tall. Two filter chips at the top: Pending QC (the
 * default — `state = in_production`) and Passed (`state = qc_passed`).
 *
 * Per-order detail screen is task 2.2; this page just navigates to it.
 */
import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { orderItems, orders } from '@/lib/db/schema';

type Filter = 'pending' | 'passed';

export default async function QcListPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  await requireRole('qc', 'admin');

  const params = await searchParams;
  const filter: Filter = params.filter === 'passed' ? 'passed' : 'pending';
  const targetState = filter === 'pending' ? 'in_production' : 'qc_passed';

  // Counts for both chips (one query — cheap aggregate by state).
  const counts = await db
    .select({ state: orders.state, n: count() })
    .from(orders)
    .where(
      and(
        inArray(orders.state, ['in_production', 'qc_passed']),
        isNull(orders.deletedAt),
      ),
    )
    .groupBy(orders.state);

  const pendingCount = counts.find((c) => c.state === 'in_production')?.n ?? 0;
  const passedCount = counts.find((c) => c.state === 'qc_passed')?.n ?? 0;

  // Active list — per-order item totals with QC'd and failed sub-counts.
  const rows = await db
    .select({
      id: orders.id,
      shopifyOrderName: orders.shopifyOrderName,
      customerName: orders.customerName,
      state: orders.state,
      tab1CompletedAt: orders.tab1CompletedAt,
      createdAt: orders.createdAt,
      totalItems: sql<number>`count(${orderItems.id})::int`,
      qcdItems: sql<number>`count(${orderItems.id}) filter (where ${orderItems.qcStatus} is not null)::int`,
      failedItems: sql<number>`count(${orderItems.id}) filter (where ${orderItems.qcStatus} = 'failed')::int`,
    })
    .from(orders)
    .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
    .where(and(eq(orders.state, targetState), isNull(orders.deletedAt)))
    .groupBy(orders.id)
    .orderBy(asc(sql`coalesce(${orders.tab1CompletedAt}, ${orders.createdAt})`));

  return (
    <main className="container max-w-xl px-4 py-5 sm:px-6 sm:py-8">
      <header className="mb-4">
        <h1 className="text-xl font-bold text-primary sm:text-2xl">Tab 3 — QC</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tap an order to QC its items.
        </p>
      </header>

      <FilterChips active={filter} pendingCount={pendingCount} passedCount={passedCount} />

      {rows.length === 0 ? (
        <Card className="mt-4">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {filter === 'pending'
              ? 'No orders are awaiting QC.'
              : 'No orders have passed QC yet.'}
          </CardContent>
        </Card>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                href={`/orders/qc/${row.id}`}
                className="block rounded-lg outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]"
              >
                <Card className="min-h-[112px] hover:bg-accent/40">
                  <CardContent className="flex flex-col gap-3 py-4">
                    <div>
                      <div className="text-base font-semibold leading-tight">
                        {row.shopifyOrderName}
                      </div>
                      <div className="text-sm text-muted-foreground">{row.customerName}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <ProgressBadge qcd={row.qcdItems} total={row.totalItems} />
                      <StateBadge state={row.state} />
                      {row.failedItems > 0 && (
                        <Badge variant="destructive">
                          QC Redo · {row.failedItems}
                        </Badge>
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

function FilterChips({
  active,
  pendingCount,
  passedCount,
}: {
  active: Filter;
  pendingCount: number;
  passedCount: number;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="QC filter">
      <FilterChip href="/orders/qc?filter=pending" active={active === 'pending'}>
        Pending QC <span className="ml-1 text-xs opacity-70">({pendingCount})</span>
      </FilterChip>
      <FilterChip href="/orders/qc?filter=passed" active={active === 'passed'}>
        Passed <span className="ml-1 text-xs opacity-70">({passedCount})</span>
      </FilterChip>
    </div>
  );
}

function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      role="tab"
      aria-selected={active}
      className={`flex min-h-[44px] items-center whitespace-nowrap rounded-full px-4 text-sm font-medium transition-colors ${
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
      }`}
    >
      {children}
    </Link>
  );
}

function StateBadge({ state }: { state: 'in_production' | 'qc_passed' | string }) {
  return state === 'qc_passed' ? (
    <Badge variant="secondary" className="bg-primary/15 text-primary">
      QC Passed
    </Badge>
  ) : (
    <Badge variant="outline">In Production</Badge>
  );
}

function ProgressBadge({ qcd, total }: { qcd: number; total: number }) {
  const allDone = total > 0 && qcd === total;
  return (
    <Badge
      variant="secondary"
      className={allDone ? 'bg-primary/15 text-primary' : ''}
    >
      {qcd}/{total} QC&apos;d
    </Badge>
  );
}
