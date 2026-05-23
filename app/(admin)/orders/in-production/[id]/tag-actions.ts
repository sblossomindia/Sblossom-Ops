'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { auth } from '@/auth';
import { addTagToOrder, removeTagFromOrder, TagError } from '@/lib/tags/sync';

const addSchema = z.object({
  orderId: z.string().uuid(),
  tagName: z.string().min(1).max(60),
  isCustomerVisible: z.boolean().optional(),
});

const removeSchema = z.object({
  orderId: z.string().uuid(),
  tagName: z.string().min(1).max(60),
});

export type TagActionResult = { ok: true } | { ok: false; error: string };

export async function addOrderTagAction(input: z.infer<typeof addSchema>): Promise<TagActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'Not signed in' };
  // QC role is read-only on Tab 2 per CLAUDE.md — exclude.
  if (session.user.role !== 'production' && session.user.role !== 'admin') {
    return { ok: false, error: 'Only production / admin can edit tags' };
  }

  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  try {
    await addTagToOrder({
      orderId: parsed.data.orderId,
      tagName: parsed.data.tagName,
      isCustomerVisible: parsed.data.isCustomerVisible,
      createdBy: session.user.id,
    });
  } catch (err) {
    if (err instanceof TagError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to add tag' };
  }

  revalidatePath(`/orders/in-production/${parsed.data.orderId}`);
  revalidatePath(`/orders/in-production`);
  return { ok: true };
}

export async function removeOrderTagAction(
  input: z.infer<typeof removeSchema>,
): Promise<TagActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'Not signed in' };
  if (session.user.role !== 'production' && session.user.role !== 'admin') {
    return { ok: false, error: 'Only production / admin can edit tags' };
  }

  const parsed = removeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  try {
    await removeTagFromOrder({
      orderId: parsed.data.orderId,
      tagName: parsed.data.tagName,
    });
  } catch (err) {
    if (err instanceof TagError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to remove tag' };
  }

  revalidatePath(`/orders/in-production/${parsed.data.orderId}`);
  revalidatePath(`/orders/in-production`);
  return { ok: true };
}
