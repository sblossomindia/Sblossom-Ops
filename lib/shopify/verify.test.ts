import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { verifyShopifyHmac } from './verify';

const SECRET = 'test-secret-do-not-use-in-prod';

function sign(body: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(body).digest('base64');
}

describe('verifyShopifyHmac', () => {
  it('accepts a correctly-signed body', async () => {
    const body = JSON.stringify({ order_id: 123, foo: 'bar' });
    const sig = sign(body);
    expect(await verifyShopifyHmac(body, sig, SECRET)).toBe(true);
  });

  it('rejects a tampered body', async () => {
    const body = JSON.stringify({ order_id: 123 });
    const sig = sign(body);
    expect(await verifyShopifyHmac(body + ' ', sig, SECRET)).toBe(false);
  });

  it('rejects a wrong secret', async () => {
    const body = 'hello';
    const sig = sign(body);
    expect(await verifyShopifyHmac(body, sig, 'different-secret')).toBe(false);
  });

  it('rejects a missing signature', async () => {
    expect(await verifyShopifyHmac('x', null, SECRET)).toBe(false);
    expect(await verifyShopifyHmac('x', undefined, SECRET)).toBe(false);
    expect(await verifyShopifyHmac('x', '', SECRET)).toBe(false);
  });

  it('rejects a missing secret', async () => {
    expect(await verifyShopifyHmac('x', sign('x'), '')).toBe(false);
  });

  it('rejects garbage signature (wrong length)', async () => {
    expect(await verifyShopifyHmac('hello', 'abc', SECRET)).toBe(false);
  });

  it('rejects garbage signature (correct length, wrong bytes)', async () => {
    const body = 'hello';
    const correct = sign(body);
    // Same length, all zeros — should not match.
    const fake = 'A'.repeat(correct.length);
    expect(await verifyShopifyHmac(body, fake, SECRET)).toBe(false);
  });

  it('is sensitive to key-reordering (matches raw bytes, not parsed JSON)', async () => {
    // Two JSON strings that parse identically but have different byte order.
    const a = '{"a":1,"b":2}';
    const b = '{"b":2,"a":1}';
    const sigA = sign(a);
    expect(await verifyShopifyHmac(a, sigA, SECRET)).toBe(true);
    expect(await verifyShopifyHmac(b, sigA, SECRET)).toBe(false);
  });
});
