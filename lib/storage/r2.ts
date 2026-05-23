/**
 * Cloudflare R2 storage helpers — presigned PUT for direct browser uploads,
 * presigned GET for views, and a server-side multipart helper.
 *
 * CLAUDE.md hard rule 4: never proxy file bytes through the server. The
 * browser PUTs directly to R2 using the presigned URLs returned from
 * `/api/uploads/sign`. We sign with PutObjectCommand which allows a single
 * PUT up to ~5 GB on R2 — fine for our 1000 MB ceiling.
 *
 * Key conventions:
 *   mockups/<orderItemId>/source-<ts>-<filename>     PSD upload
 *   mockups/<orderItemId>/thumb-<ts>-<filename>      PNG/JPG preview
 *   qc-photos/<orderItemId>/<ts>-<uuid>.<ext>        QC verification photo
 *
 * Storing timestamp + sanitized filename keeps old files around when an item's
 * mockup is replaced (mockup_history relies on the previous URL). The bucket
 * is chosen by key prefix — getViewUrl() doesn't need a bucket argument.
 */
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { env } from '@/lib/env';

const UPLOAD_TTL_SECONDS = 60 * 60; // 1 h (matches SPEC §8 "Presigned URLs for upload (PUT)")
const VIEW_TTL_SECONDS = 60 * 60; // 1 h (matches SPEC §8 "View URLs presigned with 1 h expiry")

export const R2_SIZE_LIMITS = {
  mockupSource: 1000 * 1024 * 1024, // 1000 MB (CLAUDE.md hard rule 4)
  mockupThumbnail: 5 * 1024 * 1024, // 5 MB
  qcPhoto: 10 * 1024 * 1024, // 10 MB
} as const;

export type UploadKind = 'mockup-source' | 'mockup-thumbnail' | 'qc-photo';

export interface PresignedUpload {
  uploadUrl: string;
  key: string;
  bucket: string;
  expiresAt: string; // ISO8601
  maxSizeBytes: number;
  contentType: string;
}

/* ── Client (lazy) ──────────────────────────────────────────────────────── */

let _client: S3Client | null = null;
function getClient(): S3Client {
  if (_client) return _client;
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    throw new Error('R2 credentials not configured (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)');
  }
  _client = new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });
  return _client;
}

/* ── Key path helpers ───────────────────────────────────────────────────── */

function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(-100); // keep the suffix (extension)
}

function keyForMockupSource(orderItemId: string, filename: string): string {
  return `mockups/${orderItemId}/source-${Date.now()}-${sanitizeFilename(filename)}`;
}

function keyForMockupThumb(orderItemId: string, filename: string): string {
  return `mockups/${orderItemId}/thumb-${Date.now()}-${sanitizeFilename(filename)}`;
}

function keyForQcPhoto(orderItemId: string, contentType: string): string {
  const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
  return `qc-photos/${orderItemId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
}

function bucketForKey(key: string): string {
  if (key.startsWith('mockups/')) return env.R2_MOCKUPS_BUCKET;
  if (key.startsWith('qc-photos/')) return env.R2_QC_PHOTOS_BUCKET;
  throw new Error(`Unknown R2 key prefix in: ${key}`);
}

/* ── Upload URL builders ────────────────────────────────────────────────── */

async function signPut(opts: {
  bucket: string;
  key: string;
  contentType: string;
  maxSizeBytes: number;
}): Promise<PresignedUpload> {
  const command = new PutObjectCommand({
    Bucket: opts.bucket,
    Key: opts.key,
    ContentType: opts.contentType,
  });
  const uploadUrl = await getSignedUrl(getClient(), command, { expiresIn: UPLOAD_TTL_SECONDS });
  return {
    uploadUrl,
    key: opts.key,
    bucket: opts.bucket,
    expiresAt: new Date(Date.now() + UPLOAD_TTL_SECONDS * 1000).toISOString(),
    maxSizeBytes: opts.maxSizeBytes,
    contentType: opts.contentType,
  };
}

export function getMockupSourceUploadUrl(
  orderItemId: string,
  filename: string,
  contentType = 'application/octet-stream',
): Promise<PresignedUpload> {
  return signPut({
    bucket: env.R2_MOCKUPS_BUCKET,
    key: keyForMockupSource(orderItemId, filename),
    contentType,
    maxSizeBytes: R2_SIZE_LIMITS.mockupSource,
  });
}

export function getMockupThumbUploadUrl(
  orderItemId: string,
  filename: string,
  contentType = 'image/png',
): Promise<PresignedUpload> {
  return signPut({
    bucket: env.R2_MOCKUPS_BUCKET,
    key: keyForMockupThumb(orderItemId, filename),
    contentType,
    maxSizeBytes: R2_SIZE_LIMITS.mockupThumbnail,
  });
}

export function getQcPhotoUploadUrl(
  orderItemId: string,
  contentType = 'image/jpeg',
): Promise<PresignedUpload> {
  return signPut({
    bucket: env.R2_QC_PHOTOS_BUCKET,
    key: keyForQcPhoto(orderItemId, contentType),
    contentType,
    maxSizeBytes: R2_SIZE_LIMITS.qcPhoto,
  });
}

/* ── View URL ───────────────────────────────────────────────────────────── */

/**
 * Returns a 1-hour presigned GET URL. Bucket inferred from the key prefix.
 * Per SPEC §8 these are generated fresh on every render — do not cache the
 * returned string.
 */
export async function getViewUrl(key: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: bucketForKey(key),
    Key: key,
  });
  return getSignedUrl(getClient(), command, { expiresIn: VIEW_TTL_SECONDS });
}

/* ── Server-side multipart upload ───────────────────────────────────────── */

/**
 * Multipart upload from the server (CLAUDE.md hard rule 4). Use for seed
 * scripts, image processing, or any path where bytes are already in memory.
 * Browser uploads must use the presigned-PUT path above.
 */
export async function uploadBuffer(opts: {
  key: string;
  body: Uint8Array | Blob | string;
  contentType: string;
}): Promise<{ key: string; bucket: string }> {
  const bucket = bucketForKey(opts.key);
  const upload = new Upload({
    client: getClient(),
    params: {
      Bucket: bucket,
      Key: opts.key,
      Body: opts.body,
      ContentType: opts.contentType,
    },
  });
  await upload.done();
  return { key: opts.key, bucket };
}
