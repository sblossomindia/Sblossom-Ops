/**
 * Low-level Interakt HTTP client.
 *
 * Responsibilities (CLAUDE.md hard rule 3):
 *   - Rate-limit to 35 req/min (Interakt cap is 40, we leave 5/min headroom)
 *   - Retry up to 3× on 5xx / network errors with exponential backoff + jitter
 *   - Never retry 4xx (validation errors won't get better)
 *   - Short-circuit when MOCK_INTERAKT=1 — no HTTP, no rate limit
 *
 * Does NOT write notifications_log — that's send.ts's job (hard rule 5: the
 * row is written, committed, and only then is callInterakt invoked).
 */
import { env } from '@/lib/env';

import { TokenBucket } from './rate-limiter';

const INTERAKT_URL = 'https://api.interakt.ai/v1/public/message/';
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 4000;

const bucket = new TokenBucket({
  capacity: 35,
  refillPerSecond: 35 / 60,
});

export interface InteraktTemplate {
  name: string;
  languageCode: string;
  bodyValues?: string[];
  buttonValues?: Record<string, string[]>;
  headerValues?: string[];
  fileName?: string;
}

export interface InteraktPayload {
  countryCode: string;
  phoneNumber: string;
  type: 'Template';
  callbackData?: string;
  template: InteraktTemplate;
}

export type InteraktResult =
  | { ok: true; status: number; response: unknown; attempts: number }
  | { ok: false; status?: number; response?: unknown; error: string; attempts: number };

/**
 * POST one message to Interakt. Caller is responsible for writing the
 * notifications_log row first (see send.ts).
 */
export async function callInterakt(payload: InteraktPayload): Promise<InteraktResult> {
  if (env.MOCK_INTERAKT) {
    console.warn(
      `[interakt:mock] would send ${payload.template.name} to ${payload.countryCode}${payload.phoneNumber}`,
    );
    return { ok: true, status: 200, response: { mocked: true, payload }, attempts: 0 };
  }

  if (!env.INTERAKT_API_KEY) {
    return {
      ok: false,
      error: 'INTERAKT_API_KEY not set (and MOCK_INTERAKT not enabled)',
      attempts: 0,
    };
  }

  await bucket.acquire();

  const authHeader = `Basic ${toBase64(env.INTERAKT_API_KEY + ':')}`;

  let lastErr: string | undefined;
  let lastStatus: number | undefined;
  let lastResp: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      const res = await fetch(INTERAKT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        body: JSON.stringify(payload),
      });

      const body = await res.json().catch(() => ({}));
      lastStatus = res.status;
      lastResp = body;

      if (res.ok) {
        return { ok: true, status: res.status, response: body, attempts: attempt };
      }

      // 4xx → permanent failure, don't retry.
      if (res.status >= 400 && res.status < 500) {
        return {
          ok: false,
          status: res.status,
          response: body,
          error: `interakt_${res.status}`,
          attempts: attempt,
        };
      }

      // 5xx → fall through to retry.
      lastErr = `interakt_${res.status}`;
    } catch (err) {
      lastErr = `network: ${err instanceof Error ? err.message : String(err)}`;
    }

    if (attempt <= MAX_RETRIES) {
      const delay = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (attempt - 1));
      const jitter = Math.random() * 200;
      await sleep(delay + jitter);
    }
  }

  return {
    ok: false,
    status: lastStatus,
    response: lastResp,
    error: lastErr ?? 'unknown',
    attempts: MAX_RETRIES + 1,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toBase64(s: string): string {
  // Edge + Node both support btoa for ASCII. Interakt API keys are ASCII.
  if (typeof btoa === 'function') return btoa(s);
  return Buffer.from(s, 'utf8').toString('base64');
}
