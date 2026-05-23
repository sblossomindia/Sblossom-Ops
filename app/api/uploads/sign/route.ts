/**
 * POST /api/uploads/sign
 *
 * Returns a presigned R2 upload URL for the browser to PUT directly to. The
 * route validates:
 *   - caller is authenticated (middleware also enforces this)
 *   - the order_item exists
 *   - request body matches one of the three upload kinds
 *
 * Role-based restrictions (production-can't-upload-QC-photos etc.) are
 * applied by the calling UI in Phase 2 — for now, any authenticated employee
 * can request any kind. Logging is sufficient deterrent at 5-user scale.
 *
 * Body (one of):
 *   { kind: "mockup-source",    orderItemId, filename, contentType? }
 *   { kind: "mockup-thumbnail", orderItemId, filename, contentType }
 *   { kind: "qc-photo",         orderItemId, contentType? }
 *
 * Response: { uploadUrl, key, bucket, expiresAt, maxSizeBytes, contentType }
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { auth } from '@/auth';
import { db } from '@/lib/db';
import { orderItems } from '@/lib/db/schema';
import {
  getMockupSourceUploadUrl,
  getMockupThumbUploadUrl,
  getQcPhotoUploadUrl,
} from '@/lib/storage/r2';

const bodySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('mockup-source'),
    orderItemId: z.string().uuid(),
    filename: z.string().min(1).max(255),
    contentType: z.string().min(1).max(127).optional(),
  }),
  z.object({
    kind: z.literal('mockup-thumbnail'),
    orderItemId: z.string().uuid(),
    filename: z.string().min(1).max(255),
    contentType: z.string().min(1).max(127),
  }),
  z.object({
    kind: z.literal('qc-photo'),
    orderItemId: z.string().uuid(),
    contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']).optional(),
  }),
]);

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: 'invalid_body', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const body = parsed.data;

  const [item] = await db
    .select({ id: orderItems.id })
    .from(orderItems)
    .where(eq(orderItems.id, body.orderItemId))
    .limit(1);
  if (!item) {
    return Response.json({ error: 'order_item_not_found' }, { status: 404 });
  }

  let presigned;
  switch (body.kind) {
    case 'mockup-source':
      presigned = await getMockupSourceUploadUrl(body.orderItemId, body.filename, body.contentType);
      break;
    case 'mockup-thumbnail':
      presigned = await getMockupThumbUploadUrl(body.orderItemId, body.filename, body.contentType);
      break;
    case 'qc-photo':
      presigned = await getQcPhotoUploadUrl(body.orderItemId, body.contentType);
      break;
  }

  return Response.json(presigned);
}
