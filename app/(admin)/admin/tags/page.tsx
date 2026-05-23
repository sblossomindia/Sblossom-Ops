/**
 * Admin tag dictionary page. Lists all tag_definitions with usage counts and
 * lets admins create / edit visibility / delete entries.
 */
import { asc, eq, sql } from 'drizzle-orm';
import Link from 'next/link';

import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { orderTags, tagDefinitions } from '@/lib/db/schema';

import { TagDictionary, type TagDictionaryRow } from './tag-dictionary';

export default async function AdminTagsPage() {
  await requireRole('admin');

  // Pull the dictionary + a usage count from order_tags (joined by name,
  // since order_tags has no FK to tag_definitions).
  const rows = await db
    .select({
      id: tagDefinitions.id,
      name: tagDefinitions.name,
      isCustomerVisibleDefault: tagDefinitions.isCustomerVisibleDefault,
      usageCount: sql<number>`count(${orderTags.id})::int`,
    })
    .from(tagDefinitions)
    .leftJoin(orderTags, eq(orderTags.tagName, tagDefinitions.name))
    .groupBy(tagDefinitions.id)
    .orderBy(asc(tagDefinitions.name));

  const dictionary: TagDictionaryRow[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    isCustomerVisibleDefault: r.isCustomerVisibleDefault,
    usageCount: r.usageCount,
  }));

  return (
    <main className="container max-w-3xl py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">Tag dictionary</h1>
          <p className="text-sm text-muted-foreground">
            Admin only. The names you list here power autocomplete on Tab 2 and the
            customer-visibility default.
          </p>
        </div>
        <Link href="/" className="text-sm text-muted-foreground underline hover:text-foreground">
          ← Dashboard
        </Link>
      </header>

      <TagDictionary initialRows={dictionary} />
    </main>
  );
}
