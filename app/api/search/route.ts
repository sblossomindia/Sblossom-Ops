/**
 * Global search across in-flight orders. Auth required (middleware enforces);
 * we double-check inside for defense in depth.
 *
 * Matches against:
 *   - shopify_order_number (prefix)
 *   - shopify_order_name   (prefix — handles "#1042" formatting)
 *   - customer_name        (contains, ilike)
 *   - customer_email       (contains, ilike — column is citext anyway)
 *   - customer_phone       (contains digits-only of the query, if ≥ 4 digits)
 *
 * Excludes soft-deleted orders. Returns up to 10 rows, ordered by recent
 * activity (updatedAt desc). Each row carries the right detail URL for its
 * state so the client doesn't need to know our routing.
 */
import { and, desc, ilike, isNull, or, sql } from 'drizzle-orm';

import { auth } from '@/auth';
import { db } from '@/lib/db';
import { orders } from '@/lib/db/schema';

const MAX_RESULTS = 10;
const MIN_QUERY_LEN = 2;

export interface SearchResult {
  id: string;
  shopifyOrderName: string;
  shopifyOrderNumber: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  state: 'approval_pending' | 'in_production' | 'qc_passed' | 'shipped' | 'delivered';
  detailUrl: string;
}

export async function GET(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const raw = url.searchParams.get('q')?.trim() ?? '';
  if (raw.length < MIN_QUERY_LEN) {
    return Response.json([]);
  }

  const pattern = `%${escapeLike(raw)}%`;
  const digits = raw.replace(/\D/g, '');

  // All four text fields use case-insensitive contains. The previous
  // prefix-only match on order_name/number missed seeds like `#SEED1001`
  // (leading `#` defeats a `seed%` prefix).
  const conditions = [
    ilike(orders.shopifyOrderNumber, pattern),
    ilike(orders.shopifyOrderName, pattern),
    ilike(orders.customerName, pattern),
    // customer_email is citext, but ilike still works correctly on it.
    sql`${orders.customerEmail}::text ILIKE ${pattern}`,
  ];
  if (digits.length >= 4) {
    conditions.push(ilike(orders.customerPhone, `%${digits}%`));
  }

  const rows = await db
    .select({
      id: orders.id,
      shopifyOrderName: orders.shopifyOrderName,
      shopifyOrderNumber: orders.shopifyOrderNumber,
      customerName: orders.customerName,
      customerPhone: orders.customerPhone,
      customerEmail: orders.customerEmail,
      state: orders.state,
    })
    .from(orders)
    .where(and(isNull(orders.deletedAt), or(...conditions)))
    .orderBy(desc(orders.updatedAt))
    .limit(MAX_RESULTS);

  const results: SearchResult[] = rows.map((r) => ({
    ...r,
    detailUrl: detailUrlFor(r.state, r.id),
  }));

  return Response.json(results);
}

/** Escape `%` and `_` so user input isn't interpreted as LIKE wildcards. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, '\\$&');
}

function detailUrlFor(state: SearchResult['state'], orderId: string): string {
  if (state === 'approval_pending') return `/orders/new/${orderId}`;
  // in_production + qc_passed have Tab 2 detail; shipped/delivered route there
  // too and Tab 2 detail shows a graceful "wrong state" message until Tabs 4/5
  // ship in Phase 2.
  return `/orders/in-production/${orderId}`;
}
