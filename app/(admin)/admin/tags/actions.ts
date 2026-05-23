'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { auth } from '@/auth';
import { db } from '@/lib/db';
import { tagDefinitions } from '@/lib/db/schema';
import { normalizeTagName, TagError } from '@/lib/tags/sync';

const createSchema = z.object({
  name: z.string().min(1).max(60),
  isCustomerVisibleDefault: z.boolean(),
});

const updateSchema = z.object({
  id: z.string().uuid(),
  isCustomerVisibleDefault: z.boolean(),
});

const deleteSchema = z.object({
  id: z.string().uuid(),
});

export type AdminTagResult = { ok: true } | { ok: false; error: string };

async function requireAdmin(): Promise<{ ok: false; error: string } | { ok: true; userId: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'Not signed in' };
  if (session.user.role !== 'admin') return { ok: false, error: 'Admin only' };
  return { ok: true, userId: session.user.id };
}

export async function createTagDefinitionAction(
  input: z.infer<typeof createSchema>,
): Promise<AdminTagResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  let name: string;
  try {
    name = normalizeTagName(parsed.data.name);
  } catch (err) {
    return { ok: false, error: err instanceof TagError ? err.message : 'Invalid tag name' };
  }

  const inserted = await db
    .insert(tagDefinitions)
    .values({
      name,
      isCustomerVisibleDefault: parsed.data.isCustomerVisibleDefault,
      createdBy: gate.userId,
    })
    .onConflictDoNothing({ target: tagDefinitions.name })
    .returning({ id: tagDefinitions.id });

  if (inserted.length === 0) {
    return { ok: false, error: `A tag named "${name}" already exists` };
  }

  revalidatePath('/admin/tags');
  return { ok: true };
}

export async function updateTagDefinitionAction(
  input: z.infer<typeof updateSchema>,
): Promise<AdminTagResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;

  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  const updated = await db
    .update(tagDefinitions)
    .set({ isCustomerVisibleDefault: parsed.data.isCustomerVisibleDefault })
    .where(eq(tagDefinitions.id, parsed.data.id))
    .returning({ id: tagDefinitions.id });

  if (updated.length === 0) return { ok: false, error: 'Tag definition not found' };

  revalidatePath('/admin/tags');
  return { ok: true };
}

export async function deleteTagDefinitionAction(
  input: z.infer<typeof deleteSchema>,
): Promise<AdminTagResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;

  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  // Delete the dictionary row. Note: `order_tags` rows referencing this name
  // by string are NOT cascade-deleted — they keep working as historical
  // attachments. We only manage the dictionary here.
  const deleted = await db
    .delete(tagDefinitions)
    .where(eq(tagDefinitions.id, parsed.data.id))
    .returning({ id: tagDefinitions.id });

  if (deleted.length === 0) return { ok: false, error: 'Tag definition not found' };

  revalidatePath('/admin/tags');
  return { ok: true };
}
