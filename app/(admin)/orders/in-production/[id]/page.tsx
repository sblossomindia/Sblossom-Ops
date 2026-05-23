/**
 * Tab 2 detail — read-only view of one in-flight order. Mockup thumbnails
 * + PSD links are presigned R2 GET URLs (signed fresh every render; do not
 * cache).
 *
 * No edit actions. Replace-mockup, tag management, and delete are added in
 * tasks 1.12-1.14.
 */
import { asc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { orderItems, orderTags, orders } from '@/lib/db/schema';
import { formatINR, relativeTime } from '@/lib/format';
import { getViewUrl } from '@/lib/storage/r2';

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

  const tags = await db
    .select({
      id: orderTags.id,
      tagName: orderTags.tagName,
      isCustomerVisible: orderTags.isCustomerVisible,
    })
    .from(orderTags)
    .where(eq(orderTags.orderId, order.id))
    .orderBy(asc(orderTags.tagName));

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
          {tags.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tags. Add in Tab 2 → 1.12.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <TagChip
                  key={tag.id}
                  name={tag.tagName}
                  isCustomerVisible={tag.isCustomerVisible}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Line items */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">Line items</h2>
        <div className="space-y-4">
          {itemsWithUrls.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </div>
      </section>
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

function ItemCard({ item }: { item: ItemWithUrls }) {
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

function TagChip({ name, isCustomerVisible }: { name: string; isCustomerVisible: boolean }) {
  return isCustomerVisible ? (
    <Badge variant="secondary" className="bg-secondary text-secondary-foreground">
      {name}
    </Badge>
  ) : (
    <Badge
      variant="outline"
      className="border-muted-foreground/30 text-muted-foreground"
      title="Internal-only tag"
    >
      {name}
    </Badge>
  );
}

function formatAddress(addr: Record<string, unknown>): string {
  const parts = [addr.address1, addr.address2, addr.city, addr.province, addr.zip, addr.country]
    .filter((v): v is string => typeof v === 'string' && v.length > 0);
  return parts.join(', ') || '—';
}
