/**
 * HMAC verification for Shopify webhooks.
 *
 * Uses Web Crypto so this works on both Node (next dev) and Workers runtimes —
 * `node:crypto` is unavailable in some Workers configurations.
 *
 * CLAUDE.md hard rule 6: handlers MUST call this on the raw body BEFORE
 * `req.json()` (which re-orders keys and breaks the signature).
 */

/**
 * @param rawBody The raw request body as received (string from `req.text()`).
 * @param signature The `X-Shopify-Hmac-Sha256` header value (base64).
 * @param secret The Shopify webhook signing secret.
 * @returns true if HMAC matches.
 */
export async function verifyShopifyHmac(
  rawBody: string,
  signature: string | null | undefined,
  secret: string,
): Promise<boolean> {
  if (!signature || !secret) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));

  let binary = '';
  const bytes = new Uint8Array(sigBuffer);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  const computed = btoa(binary);

  return timingSafeEqual(computed, signature);
}

/** Constant-time string compare. Returns false fast for length mismatch (the
 * length itself is not secret — both signatures are fixed-length base64 of a
 * 32-byte HMAC). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
