/**
 * Tab 2 detail — view of one in-flight order. Mockup thumbnails + PSD links
 * are presigned R2 GET URLs (signed fresh every render; do not cache).
 *
 * Tag management lives in <TagChips />. Production + admin can edit; QC role
 * sees chips read-only. Replace-mockup is task 1.13; delete is 1.14.
 */
import { asc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getSession, requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { orderItems, orderTags, orders, tagDefinitions } from '@/lib/db/schema';
import { formatINR, relativeTime } from '@/lib/format';
import { getViewUrl } from '@/lib/storage/r2';

import { DeleteOrderButton } from './delete-order-button';
import { ReplaceMockupDialog } from './replace-mockup-dialog';
import { TagChips } from './tag-chips';

export default async function InProductionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole('production', 'qc', 'admin');
  const { id } = await params;

  const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
  if (!order || order.deletedAt) notFound();
  if (order.state !== 'in_production' && order.state !== 'qc_passed') {
    // Avoid surfacing approval_pending / shipped / delivered through this tab —
    // they have their own views (or aren't viewable here).
    return (
      <main className="container max-w-3xl py-10">
        <header className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-primary">{order.shopifyOrderName}</h1>
          <Link href="/orders/in-production" className="text-sm text-muted-foreground underline">
            ← Back to list
          </Link>
        </header>
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            This order is in state <span className="font-mono">{order.state}</span>. Tab 2 only
            shows <span className="font-mono">in_production</span> and{' '}
            <span className="font-mono">qc_passed</span>.
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

  // Sign R2 view URLs for every item's thumbnail + PSD source in parallel.
  // These expire in 1 h — server-rendered every page load, fresh each time.
  const itemsWithUrls = await Promise.all(
    items.map(async (item) => ({
      ...item,
      thumbnailViewUrl: item.mockupThumbnailUrl
        ? await getViewUrl(item.mockupThumbnailUrl)
        : null,
      sourceViewUrl: item.mockupSourceUrl ? await getViewUrl(item.mockupSourceUrl) : null,
    })),
  );

  const [tags, definitions, session] = await Promise.all([
    db
      .select({
        id: orderTags.id,
        tagName: orderTags.tagName,
        isCustomerVisible: orderTags.isCustomerVisible,
      })
      .from(orderTags)
      .where(eq(orderTags.orderId, order.id))
      .orderBy(asc(orderTags.tagName)),
    db
      .select({
        name: tagDefinitions.name,
        isCustomerVisibleDefault: tagDefinitions.isCustomerVisibleDefault,
      })
      .from(tagDefinitions)
      .orderBy(asc(tagDefinitions.name)),
    getSession(),
  ]);

  const canEditTags =
    session?.user.role === 'production' || session?.user.role === 'admin';
  // Mockup replacement is pre-QC only — gate by both order state and role.
  const canReplaceMockup = canEditTags && order.state === 'in_production';
  // Soft-delete is admin-only, pre-QC only. On Tab 2 that means 'in_production'
  // (qc_passed is post-QC). The server action re-checks both gates.
  const canDelete = session?.user.role === 'admin' && order.state === 'in_production';

  return (
    <main className="container max-w-3xl py-10">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-primary">{order.shopifyOrderName}</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <StateBadge state={order.state} />
            <span>·</span>
            <span>in production {relativeTime(order.tab1CompletedAt ?? order.createdAt)}</span>
          </p>
        </div>
        <Link href="/orders/in-production" className="text-sm text-muted-foreground underline">
          ← Back to list
        </Link>
      </header>

      {/* Customer + payment */}
      <Card className="mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Customer &amp; payment</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <span className="text-muted-foreground">Name:</span>{' '}
            <span className="font-medium">{order.customerName}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Phone:</span>{' '}
            <span className="font-mono">{order.customerPhone}</span>
          </div>
          {order.customerEmail && (
            <div className="sm:col-span-2">
              <span className="text-muted-foreground">Email:</span> <span>{order.customerEmail}</span>
            </div>
          )}
          <div>
            <span className="text-muted-foreground">Payment:</span>{' '}
            <span className="font-medium">
              {order.paymentMode === 'cod' ? 'Cash on Delivery' : 'Prepaid'}
            </span>
            {order.paymentMode === 'cod' && order.codAmount && (
              <span className="text-muted-foreground"> · {formatINR(order.codAmount)}</span>
            )}
          </div>
          <div>
            <span className="text-muted-foreground">Order total:</span>{' '}
            <span>{formatINR(order.totalAmount)}</span>
          </div>
          {!!order.shippingAddress && typeof order.shippingAddress === 'object' && (
            <div className="sm:col-span-2">
              <span className="text-muted-foreground">Ship to:</span>{' '}
              <span>{formatAddress(order.shippingAddress as Record<string, unknown>)}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tags */}
      <Card className="mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Tags</CardTitle>
        </CardHeader>
        <CardContent>
          <TagChips
            orderId={order.id}
            tags={tags}
            definitions={definitions}
            canEdit={canEditTags}
          />
        </CardContent>
      </Card>

      {/* Line items */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">Line items</h2>
        <div className="space-y-4">
          {itemsWithUrls.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              replaceTrigger={
                canReplaceMockup ? (
                  <ReplaceMockupDialog
                    orderItemId={item.id}
                    orderItemTitle={
                      item.title +
                      (item.variantTitle ? ` — ${item.variantTitle}` : '') +
                      (item.quantity > 1 ? ` × ${item.quantity}` : '')
                    }
                  />
                ) : null
              }
            />
          ))}
        </div>
      </section>

      {canDelete && (
        <section className="mt-10 border-t pt-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-muted-foreground">
              Admin · Pre-QC only · Removes the order from production tabs. Shopify is untouched.
            </div>
            <DeleteOrderButton orderId={order.id} orderName={order.shopifyOrderName} />
          </div>
        </section>
      )}
    </main>
  );
}

interface ItemWithUrls {
  id: string;
  title: string;
  variantTitle: string | null;
  quantity: number;
  namesText: string | null;
  customizationNotes: string | null;
  qcStatus: 'passed' | 'failed' | null;
  qcFailureReason: string | null;
  mockupReplacedCount: number;
  thumbnailViewUrl: string | null;
  sourceViewUrl: string | null;
}

function ItemCard({
  item,
  replaceTrigger,
}: {
  item: ItemWithUrls;
  replaceTrigger?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-3 text-base">
          <span className="truncate">
            {item.title}
            {item.variantTitle && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                — {item.variantTitle}
              </span>
            )}
            {item.quantity > 1 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                × {item.quantity}
              </span>
            )}
          </span>
          <QcBadge status={item.qcStatus} />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-[160px_1fr]">
          <div>
            {item.thumbnailViewUrl ? (
              <a
                href={item.thumbnailViewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block overflow-hidden rounded-md border bg-muted"
                title="Open full thumbnail"
              >
                {/* Plain <img> (not next/image) — the URL is presigned and
                    expires in 1h, so Next's image optimizer is the wrong tool. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.thumbnailViewUrl}
                  alt={`Thumbnail for ${item.title}`}
                  className="h-40 w-full object-cover"
                />
              </a>
            ) : (
              <div className="flex h-40 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
                No thumbnail
              </div>
            )}
            {item.sourceViewUrl && (
              <a
                href={item.sourceViewUrl}
                download
                className="mt-2 inline-block text-xs text-muted-foreground underline hover:text-foreground"
              >
                Download PSD
              </a>
            )}
          </div>

          <dl className="grid grid-cols-1 gap-y-2 text-sm">
            <div>
              <dt className="text-muted-foreground">Names</dt>
              <dd className="font-medium">{item.namesText || <Em>—</Em>}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Customization notes</dt>
              <dd className="whitespace-pre-wrap">
                {item.customizationNotes || <Em>—</Em>}
              </dd>
            </div>
            {item.qcStatus === 'failed' && item.qcFailureReason && (
              <div>
                <dt className="text-muted-foreground">QC failure reason</dt>
                <dd className="text-destructive">{item.qcFailureReason}</dd>
              </div>
            )}
            {item.mockupReplacedCount > 0 && (
              <div>
                <dt className="text-muted-foreground">Mockup replaced</dt>
                <dd>
                  {item.mockupReplacedCount} time
                  {item.mockupReplacedCount === 1 ? '' : 's'}
                </dd>
              </div>
            )}
          </dl>
        </div>
        {replaceTrigger && (
          <div className="mt-4 flex justify-end border-t pt-3">{replaceTrigger}</div>
        )}
      </CardContent>
    </Card>
  );
}

function Em({ children }: { children: React.ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}

function StateBadge({ state }: { state: 'in_production' | 'qc_passed' }) {
  return state === 'qc_passed' ? (
    <Badge variant="secondary" className="bg-primary/15 text-primary">
      QC Passed
    </Badge>
  ) : (
    <Badge variant="outline">In Production</Badge>
  );
}

function QcBadge({ status }: { status: 'passed' | 'failed' | null }) {
  if (status === 'passed') {
    return (
      <Badge variant="secondary" className="bg-primary/15 text-primary">
        QC Passed
      </Badge>
    );
  }
  if (status === 'failed') {
    return (
      <Badge variant="destructive">
        QC Failed
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      Awaiting QC
    </Badge>
  );
}

function formatAddress(addr: Record<string, unknown>): string {
  const parts = [addr.address1, addr.address2, addr.city, addr.province, addr.zip, addr.country]
    .filter((v): v is string => typeof v === 'string' && v.length > 0);
  return parts.join(', ') || '—';
}
