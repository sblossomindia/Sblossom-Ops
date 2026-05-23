/**
 * Tag management: keeps `order_tags` in sync with Shopify's tag set.
 *
 * Push direction (user adds/removes via our UI):
 *   1. Apply locally (insert/delete order_tags)
 *   2. Push to Shopify via tagsAdd / tagsRemove
 *   3. On Shopify failure, roll back the local change so we don't drift
 *
 * Pull direction (Shopify webhook orders/updated):
 *   `reconcileOrderTagsFromWebhook` — diff incoming Shopify tags against our
 *   local order_tags rows. New tags get added (with default visibility from
 *   `tag_definitions` if present). Tags removed in Shopify get removed locally.
 *   The `is_customer_visible` flag on existing tags is preserved.
 *
 * The "last-write-wins" race that architecture_notes.md flags is left as a
 * known limitation — we don't have `last_tag_push_at` in the schema yet, so
 * a webhook arriving right after a local push can briefly thrash. Self-heals
 * on the next webhook.
 */
import { and, eq, inArray } from 'drizzle-orm';

import { db } from '@/lib/db';
import { orderTags, orders, tagDefinitions } from '@/lib/db/schema';
import { addShopifyOrderTags, removeShopifyOrderTags } from '@/lib/shopify/orders';

export class TagError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TagError';
  }
}

/** Allowed tag name shape — letters/digits/hyphen/underscore/space/colon, max 50. */
const TAG_NAME_RE = /^[A-Za-z0-9 _\-:]+$/;
const MAX_TAG_NAME_LEN = 50;

export function normalizeTagName(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) throw new TagError('Tag name cannot be empty');
  if (trimmed.length > MAX_TAG_NAME_LEN) {
    throw new TagError(`Tag name too long (max ${MAX_TAG_NAME_LEN})`);
  }
  if (!TAG_NAME_RE.test(trimmed)) {
    throw new TagError('Tag may only contain letters, digits, spaces, hyphens, underscores, or colons');
  }
  return trimmed;
}

/* ── Push: add ──────────────────────────────────────────────────────────── */

export interface AddTagToOrderOpts {
  orderId: string;
  tagName: string;
  /** Override the dictionary default for this row only. */
  isCustomerVisible?: boolean;
  /** User id for created_by audit. */
  createdBy: string | null;
}

export interface AddTagResult {
  added: boolean;
  alreadyExisted: boolean;
  isCustomerVisible: boolean;
}

/**
 * Add a tag to an order. Idempotent: if the tag is already attached, returns
 * `alreadyExisted: true` and skips the Shopify push.
 *
 * Auto-creates a `tag_definitions` row if the name is brand-new, so the
 * dictionary grows organically as employees type new tags.
 */
export async function addTagToOrder(opts: AddTagToOrderOpts): Promise<AddTagResult> {
  const name = normalizeTagName(opts.tagName);

  // Look up the order so we know its Shopify ID for the push.
  const [order] = await db
    .select({ id: orders.id, shopifyOrderId: orders.shopifyOrderId })
    .from(orders)
    .where(eq(orders.id, opts.orderId))
    .limit(1);
  if (!order) throw new TagError('Order not found');

  // Upsert tag_definitions so autocomplete includes user-created names.
  const definition = await ensureTagDefinition(name, opts.isCustomerVisible ?? false, opts.createdBy);
  const isCustomerVisible = opts.isCustomerVisible ?? definition.isCustomerVisibleDefault;

  // Insert order_tags. ON CONFLICT DO NOTHING gives idempotency.
  const inserted = await db
    .insert(orderTags)
    .values({
      orderId: opts.orderId,
      tagName: name,
      isCustomerVisible,
      createdBy: opts.createdBy,
    })
    .onConflictDoNothing({ target: [orderTags.orderId, orderTags.tagName] })
    .returning({ id: orderTags.id });

  if (inserted.length === 0) {
    return { added: false, alreadyExisted: true, isCustomerVisible };
  }

  // Push to Shopify. Roll back local on failure so user sees a real result.
  try {
    await addShopifyOrderTags(order.shopifyOrderId, [name]);
  } catch (err) {
    await db
      .delete(orderTags)
      .where(and(eq(orderTags.orderId, opts.orderId), eq(orderTags.tagName, name)));
    throw new TagError(
      `Shopify push failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  await stampOrderUpdated(opts.orderId);
  return { added: true, alreadyExisted: false, isCustomerVisible };
}

/* ── Push: remove ───────────────────────────────────────────────────────── */

export interface RemoveTagFromOrderResult {
  removed: boolean;
}

export async function removeTagFromOrder(opts: {
  orderId: string;
  tagName: string;
}): Promise<RemoveTagFromOrderResult> {
  const name = normalizeTagName(opts.tagName);

  const [order] = await db
    .select({ id: orders.id, shopifyOrderId: orders.shopifyOrderId })
    .from(orders)
    .where(eq(orders.id, opts.orderId))
    .limit(1);
  if (!order) throw new TagError('Order not found');

  // Capture the existing row so we can restore it if Shopify fails.
  const [existing] = await db
    .select()
    .from(orderTags)
    .where(and(eq(orderTags.orderId, opts.orderId), eq(orderTags.tagName, name)))
    .limit(1);
  if (!existing) return { removed: false };

  await db
    .delete(orderTags)
    .where(and(eq(orderTags.orderId, opts.orderId), eq(orderTags.tagName, name)));

  try {
    await removeShopifyOrderTags(order.shopifyOrderId, [name]);
  } catch (err) {
    // Restore the local row.
    await db.insert(orderTags).values({
      orderId: existing.orderId,
      tagName: existing.tagName,
      isCustomerVisible: existing.isCustomerVisible,
      createdBy: existing.createdBy,
    });
    throw new TagError(
      `Shopify remove failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  await stampOrderUpdated(opts.orderId);
  return { removed: true };
}

/* ── Pull: webhook reconciliation ───────────────────────────────────────── */

/**
 * Diff `order_tags` against the incoming Shopify tag list and apply the
 * delta. Called from the orders/updated webhook handler. Does NOT push back
 * to Shopify — pull direction only.
 */
export async function reconcileOrderTagsFromWebhook(
  orderId: string,
  incomingTags: string[],
): Promise<{ added: number; removed: number }> {
  const incoming = new Set(incomingTags.map((t) => t.trim()).filter(Boolean));
  const existing = await db
    .select({ tagName: orderTags.tagName })
    .from(orderTags)
    .where(eq(orderTags.orderId, orderId));
  const existingSet = new Set(existing.map((r) => r.tagName));

  const toAdd = [...incoming].filter((t) => !existingSet.has(t));
  const toRemove = [...existingSet].filter((t) => !incoming.has(t));

  if (toAdd.length > 0) {
    // Look up visibility defaults from the dictionary in one query.
    const defs = await db
      .select({
        name: tagDefinitions.name,
        defaultVisibility: tagDefinitions.isCustomerVisibleDefault,
      })
      .from(tagDefinitions)
      .where(inArray(tagDefinitions.name, toAdd));
    const visibilityMap = new Map(defs.map((d) => [d.name, d.defaultVisibility]));

    await db
      .insert(orderTags)
      .values(
        toAdd.map((name) => ({
          orderId,
          tagName: name,
          isCustomerVisible: visibilityMap.get(name) ?? false,
          createdBy: null,
        })),
      )
      .onConflictDoNothing({ target: [orderTags.orderId, orderTags.tagName] });
  }

  if (toRemove.length > 0) {
    await db
      .delete(orderTags)
      .where(and(eq(orderTags.orderId, orderId), inArray(orderTags.tagName, toRemove)));
  }

  return { added: toAdd.length, removed: toRemove.length };
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

async function ensureTagDefinition(
  name: string,
  defaultVisibility: boolean,
  createdBy: string | null,
): Promise<{ name: string; isCustomerVisibleDefault: boolean }> {
  // Try insert; if it already exists, fetch.
  const [inserted] = await db
    .insert(tagDefinitions)
    .values({ name, isCustomerVisibleDefault: defaultVisibility, createdBy })
    .onConflictDoNothing({ target: tagDefinitions.name })
    .returning({
      name: tagDefinitions.name,
      isCustomerVisibleDefault: tagDefinitions.isCustomerVisibleDefault,
    });
  if (inserted) return inserted;

  const [existing] = await db
    .select({
      name: tagDefinitions.name,
      isCustomerVisibleDefault: tagDefinitions.isCustomerVisibleDefault,
    })
    .from(tagDefinitions)
    .where(eq(tagDefinitions.name, name))
    .limit(1);
  if (!existing) throw new TagError(`Could not load tag definition for "${name}"`);
  return existing;
}

async function stampOrderUpdated(orderId: string): Promise<void> {
  await db.update(orders).set({ updatedAt: new Date() }).where(eq(orders.id, orderId));
}
