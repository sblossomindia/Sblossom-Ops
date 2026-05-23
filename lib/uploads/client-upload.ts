/**
 * Browser-side upload helper. Uses XMLHttpRequest so we can surface progress —
 * `fetch` doesn't yet expose upload progress events.
 *
 * The PUT must send the EXACT Content-Type the server signed with, otherwise
 * R2 rejects the signature.
 */

export interface SignResponse {
  uploadUrl: string;
  key: string;
  bucket: string;
  expiresAt: string;
  maxSizeBytes: number;
  contentType: string;
}

export type UploadKind = 'mockup-source' | 'mockup-thumbnail' | 'qc-photo';

export async function requestSignedUpload(opts: {
  kind: UploadKind;
  orderItemId: string;
  filename?: string;
  contentType: string;
}): Promise<SignResponse> {
  const body: Record<string, unknown> = {
    kind: opts.kind,
    orderItemId: opts.orderItemId,
    contentType: opts.contentType,
  };
  if (opts.filename !== undefined) body.filename = opts.filename;

  const res = await fetch('/api/uploads/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Could not get upload URL (${res.status}) ${detail}`);
  }
  return (await res.json()) as SignResponse;
}

/**
 * PUT a File/Blob to R2 with upload progress.
 *
 * Sends the file body raw — no multipart/form-data wrapping (that breaks the
 * S3 signature for PutObject). Resolves on 2xx, rejects otherwise.
 */
export function putWithProgress(
  uploadUrl: string,
  file: Blob,
  contentType: string,
  onProgress?: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', contentType);

    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress((e.loaded / e.total) * 100);
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed: HTTP ${xhr.status} ${xhr.responseText.slice(0, 200)}`));
    };
    xhr.onerror = () => reject(new Error('Network error during upload (check CORS)'));
    xhr.onabort = () => reject(new Error('Upload aborted'));

    xhr.send(file);
  });
}

/** Helper: combine sign + put. Returns the R2 key once upload succeeds. */
export async function uploadFile(opts: {
  kind: UploadKind;
  orderItemId: string;
  file: File;
  /** Override the file's MIME type (e.g. force application/octet-stream for PSDs). */
  contentType?: string;
  onProgress?: (pct: number) => void;
}): Promise<{ key: string; bucket: string }> {
  const contentType = opts.contentType ?? opts.file.type ?? 'application/octet-stream';

  const presigned = await requestSignedUpload({
    kind: opts.kind,
    orderItemId: opts.orderItemId,
    filename: opts.file.name,
    contentType,
  });

  if (opts.file.size > presigned.maxSizeBytes) {
    const maxMb = Math.round(presigned.maxSizeBytes / 1024 / 1024);
    throw new Error(`File too large (max ${maxMb} MB; got ${Math.round(opts.file.size / 1024 / 1024)} MB)`);
  }

  await putWithProgress(presigned.uploadUrl, opts.file, presigned.contentType, opts.onProgress);
  return { key: presigned.key, bucket: presigned.bucket };
}
